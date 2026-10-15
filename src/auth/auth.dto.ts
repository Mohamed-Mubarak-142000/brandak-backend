import { IsEmail, IsIn, IsString, Length, Matches, MaxLength } from 'class-validator';

// At least 8 chars with a letter and a digit. Kept simple so it is easy to explain in the app.
const STRONG_PASSWORD = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;
const PASSWORD_MESSAGE = 'password must be 8+ characters and include a letter and a number';

export class RegisterDto {
  @IsString()
  @Length(2, 100)
  name: string;

  @IsEmail()
  @MaxLength(254)
  email: string;

  /** Egyptian mobile number, e.g. 01012345678 or +201012345678. */
  @IsString()
  @MaxLength(20)
  phone: string;

  @Matches(STRONG_PASSWORD, { message: PASSWORD_MESSAGE })
  password: string;
}

export class LoginDto {
  /** Email or phone number. */
  @IsString()
  @MaxLength(254)
  identifier: string;

  @IsString()
  @MaxLength(128)
  password: string;
}

export class RefreshDto {
  @IsString()
  @MaxLength(200)
  refreshToken: string;
}

export class RequestVerificationDto {
  @IsIn(['email', 'phone'])
  channel: 'email' | 'phone';
}

export class VerifyContactDto extends RequestVerificationDto {
  @Matches(/^\d{6}$/)
  code: string;
}

export class ForgotPasswordDto {
  @IsString()
  @MaxLength(254)
  identifier: string;
}

export class ResetPasswordDto extends ForgotPasswordDto {
  @Matches(/^\d{6}$/)
  code: string;

  @Matches(STRONG_PASSWORD, { message: PASSWORD_MESSAGE })
  newPassword: string;
}
