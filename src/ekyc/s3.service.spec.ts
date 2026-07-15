import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Service } from './s3.service';

jest.mock('@aws-sdk/client-s3', () => ({
  CreateBucketCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

describe('S3Service presigned URLs', () => {
  let service: S3Service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new S3Service();
  });

  it('creates a presigned upload URL and storage key', async () => {
    (getSignedUrl as jest.Mock).mockResolvedValue('https://example.com/upload');

    const result = await service.createPresignedUpload({
      fileName: 'photo.png',
      contentType: 'image/png',
      contentLength: 1048576,
    } as any);

    expect(result.key).toContain('photo.png');
    expect(result.presignedUrl).toBe('https://example.com/upload');
  });

  it('creates a presigned view URL from a storage key', async () => {
    (getSignedUrl as jest.Mock).mockResolvedValue('https://example.com/view');

    const result = await service.createPresignedView({ key: 'users/1/photo.png' } as any);

    expect(result.key).toBe('users/1/photo.png');
    expect(result.presignedUrl).toBe('https://example.com/view');
  });
});
