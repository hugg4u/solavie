import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { UserEntity } from '../entities/user.entity';
import { REDIS_QUEUE_CLIENT } from '../../../core/redis/redis.module';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;

  const mockUserRepository = {
    findOne: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  const mockRedisClient = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_ACCESS_EXPIRES_IN') return 900;
      if (key === 'JWT_REFRESH_EXPIRES_IN') return 604800;
      return null;
    }),
  };

  const mockDataSource = {
    transaction: jest.fn().mockImplementation((cb) =>
      cb({
        getRepository: jest.fn().mockReturnValue({
          findOne: jest.fn().mockResolvedValue(null),
          save: jest.fn().mockResolvedValue({}),
        }),
      }),
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: mockUserRepository,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: REDIS_QUEUE_CLIENT,
          useValue: mockRedisClient,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: getQueueToken('iam_outbox'),
          useValue: {
            add: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('should throw UnauthorizedException if IP is blocked (brute-force)', async () => {
      mockRedisClient.get.mockResolvedValueOnce('5'); // 5 attempts

      await expect(
        service.login(
          { email: 'test@solavie.vn', password: 'password' },
          '127.0.0.1',
          'user-agent',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should successfully login and return tokens', async () => {
      mockRedisClient.get.mockResolvedValueOnce('0'); // 0 attempts

      const mockUser = {
        id: '123',
        email: 'test@solavie.vn',
        passwordHash: 'hashed_password',
        isActive: true,
      };
      mockUserRepository.findOne.mockResolvedValueOnce(mockUser);

      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      mockJwtService.sign.mockReturnValue('mock_access_token');

      const result = await service.login(
        { email: 'test@solavie.vn', password: 'password' },
        '127.0.0.1',
        'user-agent',
      );

      expect(result).toHaveProperty('accessToken', 'mock_access_token');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('expiresIn', 900);
      expect(mockRedisClient.set).toHaveBeenCalled();
    });
  });
});
