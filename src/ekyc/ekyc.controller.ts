import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Auth } from '../common/decorators/auth.decorator';
import { EkycService } from './ekyc.service';
import { VerifyIdentityDto } from './dto/verify-identity.dto';
import { LivenessAction } from './liveness.service';

@Controller('ekyc')
export class EkycController {
  constructor(private readonly ekycService: EkycService) {}

  // ─── Status ──────────────────────────────────────────────────────────────

  @Get('status')
  @Auth()
  @ApiOperation({ summary: 'Get E-KYC service status' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  getStatus() {
    return this.ekycService.getStatus();
  }

  // ─── Session ─────────────────────────────────────────────────────────────

  @Post('start')
  @Auth()
  @ApiOperation({ summary: 'Start a new E-KYC workflow' })
  @ApiResponse({ status: 201, description: 'E-KYC session started' })
  startEkyc() {
    return this.ekycService.startEkyc();
  }

  // ─── Image uploads ────────────────────────────────────────────────────────

  @Post('upload-id-front')
  @Auth()
  @ApiOperation({ summary: 'Store an existing S3 key as the ID front image' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        key: { type: 'string' },
      },
      required: ['requestId', 'key'],
    },
  })
  @ApiResponse({ status: 201, description: 'ID front image key stored' })
  uploadIdFront(@Body() payload: { requestId: string; key: string }) {
    return this.ekycService.uploadIdFront(payload);
  }

  @Post('upload-id-back')
  @Auth()
  @ApiOperation({ summary: 'Store an existing S3 key as the ID back image' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        key: { type: 'string' },
      },
      required: ['requestId', 'key'],
    },
  })
  @ApiResponse({ status: 201, description: 'ID back image key stored' })
  uploadIdBack(@Body() payload: { requestId: string; key: string }) {
    return this.ekycService.uploadIdBack(payload);
  }

  @Post('upload-selfie')
  @Auth()
  @ApiOperation({ summary: 'Store an existing S3 key as the selfie image' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        key: { type: 'string' },
      },
      required: ['requestId', 'key'],
    },
  })
  @ApiResponse({ status: 201, description: 'Selfie image key stored' })
  uploadSelfie(@Body() payload: { requestId: string; key: string }) {
    return this.ekycService.uploadSelfie(payload);
  }

  /**
   * Browser-friendly upload: sends file directly to NestJS which uploads to S3.
   * Avoids Supabase S3 CORS 403 on browser PUT.
   * FormData fields: file (binary), requestId (string), type (id-front|id-back|selfie)
   */
  @Post('upload-file')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload file via NestJS → S3 (browser-safe, no CORS)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        requestId: { type: 'string' },
        type: { type: 'string', enum: ['id-front', 'id-back', 'selfie'] },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Returns { key, status, requestId }',
  })
  uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body?: { requestId?: string; type?: 'id-front' | 'id-back' | 'selfie' },
  ) {
    return this.ekycService.uploadFile({
      requestId: body?.requestId,
      file,
      type: body?.type,
    });
  }

  // ─── Liveness ────────────────────────────────────────────────────────────

  @Post('liveness/request')
  @Auth()
  @ApiOperation({
    summary: 'Request a random liveness challenge',
    description:
      'Returns a random action (blink / smile / turn_left / turn_right / nod) ' +
      'that the user must perform. The client captures the action and then calls ' +
      '`POST /ekyc/liveness/confirm` with the `challengeId` and performed `action`.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { requestId: { type: 'string' } },
      required: ['requestId'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Liveness challenge issued',
    schema: {
      example: {
        requestId: 'uuid',
        challengeId: 'uuid',
        action: 'blink',
        instruction: 'Please blink both eyes',
        expiresIn: 60,
      },
    },
  })
  requestLiveness(@Body() payload: { requestId: string }) {
    return this.ekycService.requestLiveness(payload.requestId);
  }

  @Post('liveness/confirm')
  @Auth()
  @ApiOperation({
    summary: 'Confirm a liveness challenge',
    description:
      'Client echoes back the `challengeId` and the `action` it performed. ' +
      'In production this endpoint would also accept a video/frame buffer for ' +
      'server-side anti-spoofing analysis.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        challengeId: { type: 'string' },
        action: {
          type: 'string',
          enum: ['blink', 'smile', 'turn_left', 'turn_right', 'nod'],
        },
      },
      required: ['requestId', 'challengeId', 'action'],
    },
  })
  @ApiResponse({ status: 201, description: 'Liveness check passed' })
  @ApiResponse({
    status: 400,
    description: 'Wrong action or challenge expired',
  })
  confirmLiveness(
    @Body()
    payload: {
      requestId: string;
      challengeId: string;
      action: LivenessAction;
    },
  ) {
    return this.ekycService.confirmLiveness(payload);
  }

  // ─── Verify ──────────────────────────────────────────────────────────────

  @Post('verify')
  @Auth()
  @ApiOperation({
    summary: 'Verify identity — runs OCR + CompreFace face match',
    description:
      'Requires ID front, selfie, and a **passed liveness challenge** before calling. ' +
      'Uses CompreFace (self-hosted) for face comparison.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { requestId: { type: 'string' } },
      required: ['requestId'],
    },
  })
  @ApiResponse({ status: 201, description: 'Verification result' })
  verifyIdentity(@Body() payload: VerifyIdentityDto) {
    return this.ekycService.verifyIdentity(payload);
  }

  // ─── Result ──────────────────────────────────────────────────────────────

  @Get('result/:requestId')
  @Auth()
  @ApiOperation({ summary: 'Get the stored E-KYC verification result' })
  @ApiResponse({ status: 200, description: 'Verification result returned' })
  getResult(@Param('requestId') requestId: string) {
    return this.ekycService.getResult(requestId);
  }
}
