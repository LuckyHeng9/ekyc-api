import 'dotenv/config';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { connectToDatabase } from './core/db';

async function listenWithFallback(
  app: NestExpressApplication,
  port: number,
  attempt = 0,
) {
  const candidatePort = port + attempt;

  try {
    await app.listen(candidatePort);
    console.log(`Application is running on: http://localhost:${candidatePort}`);
  } catch (error: unknown) {
    const err = error as { code?: string };
    if (err?.code === 'EADDRINUSE' && attempt < 10) {
      console.warn(
        `Port ${candidatePort} is busy, trying ${candidatePort + 1}...`,
      );
      await listenWithFallback(app, port, attempt + 1);
      return;
    }

    throw error;
  }
}

async function killProcessOnPort(port: number) {
  try {
    const { execSync } = await import('node:child_process');
    execSync(`fuser -k ${port}/tcp || true`, { stdio: 'ignore' });
  } catch {
    // ignore cleanup failures
  }
}

async function bootstrap() {
  await connectToDatabase();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('E-KYC API')
    .setDescription('E-KYC API documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  app.useStaticAssets(join(__dirname, '..', 'public'), {
    prefix: '/',
  });

  app.enableCors();
  const port = Number(process.env.PORT ?? 2000);
  await killProcessOnPort(port);
  await listenWithFallback(app, port);
}
void bootstrap();
