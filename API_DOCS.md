# E-KYC API Documentation

This document contains the complete REST API reference for the **E-KYC API** application.

---

## 🌐 Interactive Swagger Documentation

When the application is running, interactive API documentation (Swagger UI) is available at:

👉 **[http://localhost:2000/docs](http://localhost:2000/docs)** *(or your configured `PORT` in `.env`)*

---

## 🔒 Authentication

Endpoints marked with 🔒 **Bearer Auth** require an `Authorization` HTTP header with a valid JWT token:

```http
Authorization: Bearer <your_access_token>
```

---

## 📋 API Route Index

| Group | Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :---: | :--- |
| **System** | `GET` | `/` | ❌ | Health check / Hello World |
| **Users** | `GET` | `/users` | ❌ | List all users |
| **Users** | `GET` | `/users/:id` | ❌ | Get user by ID |
| **Upload** | `POST` | `/upload/file` | ❌ | 2-Step upload via NestJS → S3 + OCR |
| **Upload** | `POST` | `/upload/presign-upload` | 🔒 | Get presigned S3 upload policy |
| **Upload** | `POST` | `/upload/presign-view` | 🔒 | Get presigned S3 inline view URL |
| **E-KYC** | `GET` | `/ekyc/status` | 🔒 | Check E-KYC service status |
| **E-KYC** | `POST` | `/ekyc/start` | 🔒 | Start new E-KYC verification session |
| **E-KYC** | `POST` | `/ekyc/upload-file` | ❌ | Direct file upload for E-KYC (No CORS) |
| **E-KYC** | `POST` | `/ekyc/upload-id-front` | 🔒 | Attach S3 key as ID Front image |
| **E-KYC** | `POST` | `/ekyc/upload-id-back` | 🔒 | Attach S3 key as ID Back image |
| **E-KYC** | `POST` | `/ekyc/upload-selfie` | 🔒 | Attach S3 key as Selfie image |
| **E-KYC** | `POST` | `/ekyc/liveness/request` | 🔒 | Request random liveness challenge |
| **E-KYC** | `POST` | `/ekyc/liveness/confirm` | 🔒 | Confirm liveness challenge action |
| **E-KYC** | `POST` | `/ekyc/verify` | 🔒 | Perform identity verification (OCR + Face Match) |
| **E-KYC** | `GET` | `/ekyc/result/:requestId` | 🔒 | Fetch verification result by request ID |

---

## 📑 Detailed Endpoint Reference

### 1. System

#### `GET /`
- **Summary**: Server status check
- **Response**: `200 OK` (`"Hello World!"`)

---

### 2. Users (`/users`)

#### `GET /users`
- **Summary**: Get all users
- **Response**: `200 OK`
  ```json
  [
    {
      "_id": "60d5ec49f1b2c81234567890",
      "username": "johndoe",
      "email": "john@example.com"
    }
  ]
  ```

#### `GET /users/:id`
- **Summary**: Get a user by ID
- **Path Parameters**:
  - `id` *(string, required)*: MongoDB ObjectId
- **Response**: `200 OK` (User object) or `404 Not Found`

---

### 3. File Upload (`/upload`, `/uploads`, `/api/v1/upload`, `/api/v1/uploads`)

#### `POST /upload/file`
- **Summary**: 2-Step backend file upload to Supabase S3 + OCR processing.
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `file`: `file` (binary, required)
- **Response**: `201 Created`
  ```json
  {
    "key": "uploads/1710000000000-id.jpg",
    "url": "https://<supabase-s3-bucket>/uploads/1710000000000-id.jpg",
    "ocrResult": {
      "text": "..."
    }
  }
  ```

#### `POST /upload/presign-upload` 🔒
- **Summary**: Create a presigned S3 upload policy for client-side direct S3 upload.
- **Content-Type**: `application/json`
- **Body**:
  ```json
  {
    "fileName": "id-card.jpg",
    "contentType": "image/jpeg",
    "contentLength": 1048576
  }
  ```
- **Response**: `201 Created`

#### `POST /upload/presign-view` 🔒
- **Summary**: Create a presigned S3 view URL for displaying inline media.
- **Content-Type**: `application/json`
- **Body**:
  ```json
  {
    "key": "uploads/1710000000000-id.jpg"
  }
  ```
- **Response**: `201 Created`

---

### 4. E-KYC Service (`/ekyc`)

#### `GET /ekyc/status` 🔒
- **Summary**: Get current E-KYC service status.
- **Response**: `200 OK`
  ```json
  {
    "status": "ready"
  }
  ```

#### `POST /ekyc/start` 🔒
- **Summary**: Start a new E-KYC workflow session.
- **Response**: `201 Created`
  ```json
  {
    "requestId": "550e8400-e29b-41d4-a716-446655440000"
  }
  ```

#### `POST /ekyc/upload-file`
- **Summary**: Browser-friendly upload directly to S3 via NestJS backend (avoids browser CORS issues).
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `file`: `file` (binary, required)
  - `requestId`: `string`
  - `type`: `"id-front"` | `"id-back"` | `"selfie"`
- **Response**: `201 Created`
  ```json
  {
    "key": "ekyc/550e8400.../id-front.jpg",
    "status": "stored",
    "requestId": "550e8400-e29b-41d4-a716-446655440000"
  }
  ```

#### `POST /ekyc/upload-id-front` 🔒
- **Summary**: Store an existing S3 key as the ID front image.
- **Content-Type**: `application/json`
- **Body**:
  ```json
  {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "key": "ekyc/550e8400.../id-front.jpg"
  }
  ```
- **Response**: `201 Created`

#### `POST /ekyc/upload-id-back` 🔒
- **Summary**: Store an existing S3 key as the ID back image.
- **Content-Type**: `application/json`
- **Body**:
  ```json
  {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "key": "ekyc/550e8400.../id-back.jpg"
  }
  ```
- **Response**: `201 Created`

#### `POST /ekyc/upload-selfie` 🔒
- **Summary**: Store an existing S3 key as the selfie image.
- **Content-Type**: `application/json`
- **Body**:
  ```json
  {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "key": "ekyc/550e8400.../selfie.jpg"
  }
  ```
- **Response**: `201 Created`

#### `POST /ekyc/liveness/request` 🔒
- **Summary**: Issue a random liveness challenge to the user.
- **Content-Type**: `application/json`
- **Body**:
  ```json
  {
    "requestId": "550e8400-e29b-41d4-a716-446655440000"
  }
  ```
- **Response**: `201 Created`
  ```json
  {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "challengeId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "action": "blink",
    "instruction": "Please blink both eyes",
    "expiresIn": 60
  }
  ```
  *(Actions can be: `blink`, `smile`, `turn_left`, `turn_right`, `nod`)*

#### `POST /ekyc/liveness/confirm` 🔒
- **Summary**: Confirm completion of a liveness challenge.
- **Content-Type**: `application/json`
- **Body**:
  ```json
  {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "challengeId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "action": "blink"
  }
  ```
- **Response**: `201 Created` (Challenge passed) or `400 Bad Request` (Wrong action / expired)

#### `POST /ekyc/verify` 🔒
- **Summary**: Verify identity — runs OCR extractions + CompreFace face matching.
- **Requirements**: ID Front, Selfie, and passed liveness challenge.
- **Content-Type**: `application/json`
- **Body**:
  ```json
  {
    "requestId": "550e8400-e29b-41d4-a716-446655440000"
  }
  ```
- **Response**: `201 Created`
  ```json
  {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "verified",
    "similarity": 0.95,
    "ocrData": { ... }
  }
  ```

#### `GET /ekyc/result/:requestId` 🔒
- **Summary**: Retrieve stored verification result.
- **Path Parameters**:
  - `requestId` *(string, required)*: E-KYC session ID
- **Response**: `200 OK`
