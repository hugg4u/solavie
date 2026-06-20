import {
  IsString,
  IsOptional,
  IsUrl,
  MinLength,
  IsNotEmpty,
  Matches,
  IsEnum,
} from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  fullName?: string;

  @IsUrl()
  @IsOptional()
  avatarUrl?: string;

  @IsEnum(['vi', 'en'])
  @IsOptional()
  preferredLang?: 'vi' | 'en';

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  timezone?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  theme?: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(6)
  oldPassword: string;

  @IsString()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/, {
    message:
      'New password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number',
  })
  newPassword: string;
}
