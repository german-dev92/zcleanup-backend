import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFile } from 'fs/promises';
import { resolve } from 'path';
import { AppModule } from './app.module';

async function generateOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  const config = new DocumentBuilder()
    .setTitle('ZCleanUp API')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);

  const out =
    typeof process.env.OPENAPI_OUTPUT === 'string' &&
    process.env.OPENAPI_OUTPUT.trim()
      ? process.env.OPENAPI_OUTPUT.trim()
      : resolve(process.cwd(), 'openapi.json');

  await writeFile(out, JSON.stringify(document, null, 2), 'utf8');
  await app.close();
}

void generateOpenApi();
