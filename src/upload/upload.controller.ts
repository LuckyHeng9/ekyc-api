import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { Auth } from '../common/decorators/auth.decorator';
import { UploadService } from './upload.service';

@Controller('upload')
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
}
