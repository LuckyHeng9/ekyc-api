import {
  Body,
  Controller,
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
import { UploadService } from './upload.service';

@Controller(['upload', 'uploads', 'api/v1/upload', 'api/v1/uploads'])
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('presign-upload')
  @Auth()
  @ApiOperation({ summary: 'Create a presigned S3 upload policy' })
  @ApiConsumes('application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        fileName: { type: 'string' },
        contentType: { type: 'string' },
        contentLength: { type: 'number' },
      },
      required: ['fileName', 'contentType'],
    },
  })
  @ApiResponse({ status: 201, description: 'Presigned upload created' })
  async createPresignedUpload(
    @Body()
    body: {
      fileName: string;
      contentType: string;
      contentLength?: number;
    },
  ) {
    return this.uploadService.createPresignedUpload(body);
  }

  @Post('presign-view')
  @Auth()
  @ApiOperation({ summary: 'Create a presigned S3 view URL for inline media' })
  @ApiConsumes('application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
      },
      required: ['key'],
    },
  })
  @ApiResponse({ status: 201, description: 'Presigned view URL created' })
  async createPresignedView(@Body() body: { key: string }) {
    return this.uploadService.createPresignedView(body);
  }

  @Post('file')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      '2-Step Backend Upload: Upload file via NestJS → Supabase S3 + OCR (bypasses browser 403 CORS)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Returns { key, url, ocrResult }' })
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    return this.uploadService.uploadFile(file);
  }
}
