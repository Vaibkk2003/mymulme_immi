import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import z from 'zod';

export class MyMulMeMatchUploadDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'A live selfie captured for matching' })
  file!: Express.Multer.File;
}

const MyMulMePageSearchSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).describe('Page number'),
    size: z.coerce.number().int().min(1).max(50).default(24).describe('Number of matches to return'),
  })
  .meta({ id: 'MyMulMePageSearchDto' });

export class MyMulMePageSearchDto extends createZodDto(MyMulMePageSearchSchema) {}

const MyMulMeMatchAssetSchema = z
  .object({
    assetId: z.uuidv4().describe('Matched admin library asset ID'),
    fileCreatedAt: z.string().meta({ format: 'date-time' }).describe('Asset capture date'),
    thumbnail: z.string().describe('Temporary thumbnail data URL'),
  })
  .meta({ id: 'MyMulMeMatchAssetDto' });

const MyMulMeMatchResponseSchema = z
  .object({
    items: z.array(MyMulMeMatchAssetSchema),
    page: z.int().min(1),
    size: z.int().min(1),
    hasNextPage: z.boolean(),
  })
  .meta({ id: 'MyMulMeMatchResponseDto' });

export class MyMulMeMatchResponseDto extends createZodDto(MyMulMeMatchResponseSchema) {}
