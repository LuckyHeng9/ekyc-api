import { ApiProperty } from '@nestjs/swagger';

export class PreviewRequestDto {
  @ApiProperty({ example: 'front/sample-image.png', description: 'Stored object key for the uploaded image' })
  key!: string;
}
