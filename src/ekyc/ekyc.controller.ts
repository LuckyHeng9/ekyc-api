import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { Auth } from '../common/decorators/auth.decorator';
import { EkycService } from './ekyc.service';
import { VerifyIdentityDto } from './dto/verify-identity.dto';

@Controller('ekyc')
export class EkycController {
  constructor(private readonly ekycService: EkycService) {}

  @Get('status')
  @Auth()
  @ApiOperation({ summary: 'Get E-KYC service status' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  getStatus() {
    return this.ekycService.getStatus();
  }

  @Post('start')
  @Auth()
  @ApiOperation({ summary: 'Start a new E-KYC workflow' })
  @ApiResponse({ status: 201, description: 'E-KYC session started' })
  startEkyc() {
    return this.ekycService.startEkyc();
  }

  @Post('upload-id-front')
  @Auth()
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload the ID front image for an E-KYC session (file upload)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        file: { type: 'string', format: 'binary' },
      },
      required: ['requestId', 'file'],
    },
  })
  @ApiResponse({ status: 201, description: 'ID front image uploaded to S3' })
  uploadIdFrontFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { requestId: string },
  ) {
    return this.ekycService.uploadIdFrontFile(body.requestId, file);
  }

  @Post('upload-id-back')
  @Auth()
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload the ID back image for an E-KYC session (file upload)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        file: { type: 'string', format: 'binary' },
      },
      required: ['requestId', 'file'],
    },
  })
  @ApiResponse({ status: 201, description: 'ID back image uploaded to S3' })
  uploadIdBackFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { requestId: string },
  ) {
    return this.ekycService.uploadIdBackFile(body.requestId, file);
  }

  @Post('upload-selfie')
  @Auth()
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload the selfie image for an E-KYC session (file upload)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        file: { type: 'string', format: 'binary' },
      },
      required: ['requestId', 'file'],
    },
  })
  @ApiResponse({ status: 201, description: 'Selfie image uploaded to S3' })
  uploadSelfieFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { requestId: string },
  ) {
    return this.ekycService.uploadSelfieFile(body.requestId, file);
  }

  @Post('upload-id-front-key')
  @Auth()
  @ApiOperation({
    summary: 'Store an existing S3 key as the ID front image',
  })
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

  @Post('upload-selfie-key')
  @Auth()
  @ApiOperation({
    summary: 'Store an existing S3 key as the selfie image',
  })
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

  @Post('verify')
  @Auth()
  @ApiOperation({ summary: 'Verify identity information' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
      },
      required: ['requestId'],
    },
  })
  @ApiResponse({ status: 201, description: 'Verification result' })
  verifyIdentity(@Body() payload: VerifyIdentityDto) {
    return this.ekycService.verifyIdentity(payload);
  }

  @Get('result/:requestId')
  @Auth()
  @ApiOperation({ summary: 'Get the stored E-KYC verification result' })
  @ApiResponse({ status: 200, description: 'Verification result returned' })
  getResult(@Param('requestId') requestId: string) {
    return this.ekycService.getResult(requestId);
  }
}
