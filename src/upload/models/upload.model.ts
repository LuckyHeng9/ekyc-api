export interface UploadImageResponse {
  fileName: string;
  key: string;
  bucket: string;
  url: string;
  previewUrl: string;
}

export interface PreviewResponse {
  key: string;
  previewUrl: string;
}
