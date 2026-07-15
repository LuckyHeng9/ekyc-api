import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBody,
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

  @Post('upload-id-back')
  @Auth()
  @ApiOperation({
    summary: 'Store an existing S3 key as the ID back image',
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
  @ApiResponse({ status: 201, description: 'ID back image key stored' })
  uploadIdBack(@Body() payload: { requestId: string; key: string }) {
    return this.ekycService.uploadIdBack(payload);
  }

  @Post('upload-selfie')
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
