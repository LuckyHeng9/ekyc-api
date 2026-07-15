import { Injectable, Logger } from '@nestjs/common';
import * as canvas from 'canvas';
// Register the pure-JS TensorFlow CPU backend (avoids ~380 MB native tfjs-node)
import '@tensorflow/tfjs';
import * as faceapi from '@vladmandic/face-api';
import { join } from 'node:path';

export interface FaceMatchResult {
  matched: boolean;
  distance: number;       // 0 = identical, 1 = totally different
  confidence: number;     // 0–100%
  message: string;
}

const MATCH_THRESHOLD = 0.5; // lower = stricter (0.4–0.6 is typical)

@Injectable()
export class FaceMatchService {
  private readonly logger = new Logger(FaceMatchService.name);
  private modelsLoaded = false;

  async loadModels() {
    if (this.modelsLoaded) return;

    const modelPath = join(process.cwd(), 'models');
    this.logger.log(`Loading face-api models from: ${modelPath}`);

    // Patch canvas into face-api (required for Node.js)
    const { Canvas, Image, ImageData } = canvas;
    faceapi.env.monkeyPatch({ Canvas: Canvas as any, Image: Image as any, ImageData: ImageData as any });

    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath);

    this.modelsLoaded = true;
    this.logger.log('Face-api models loaded ✅');
  }

  async compareFaces(idImageBuffer: Buffer, selfieBuffer: Buffer): Promise<FaceMatchResult> {
    await this.loadModels();

    const idDescriptor = await this.getFaceDescriptor(idImageBuffer, 'ID image');
    const selfieDescriptor = await this.getFaceDescriptor(selfieBuffer, 'selfie');

    if (!idDescriptor || !selfieDescriptor) {
      return {
        matched: false,
        distance: 1,
        confidence: 0,
        message: !idDescriptor
          ? 'No face detected in ID image'
          : 'No face detected in selfie',
      };
    }

    const distance = faceapi.euclideanDistance(idDescriptor, selfieDescriptor);
    const confidence = Math.max(0, Math.round((1 - distance) * 100));
    const matched = distance < MATCH_THRESHOLD;

    this.logger.log(`Face match: distance=${distance.toFixed(3)}, confidence=${confidence}%, matched=${matched}`);

    return {
      matched,
      distance: parseFloat(distance.toFixed(4)),
      confidence,
      message: matched
        ? `Face match successful (${confidence}% confidence)`
        : `Face mismatch (distance too high: ${distance.toFixed(3)})`,
    };
  }

  private async getFaceDescriptor(buffer: Buffer, label: string): Promise<Float32Array | undefined> {
    try {
      const img = await canvas.loadImage(buffer);
      const detection = await faceapi
        .detectSingleFace(img as any)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        this.logger.warn(`No face found in ${label}`);
        return undefined;
      }

      return detection.descriptor;
    } catch (err) {
      this.logger.error(`Failed to process ${label}: ${err}`);
      return undefined;
    }
  }
}
