/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-floating-promises */
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import helmet from '@fastify/helmet';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true },
  );

  // Use Winston Logger
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  // Security headers
  await app.register(helmet);

  // Cookie parser
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  await app.register(require('@fastify/cookie'), {
    secret: process.env.COOKIE_SECRET || 'my-secret', // should be from config
  });

  // CORS
  app.enableCors({
    origin: '*', // Tạm thời allow all trong dev
  });

  // Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  await app.listen(3000, '0.0.0.0');
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
