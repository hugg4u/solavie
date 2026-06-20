import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { UserEntity } from '../entities/user.entity';
import { REDIS_QUEUE_CLIENT } from '../../../core/redis/redis.module';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

interface MockRepository {
  findOne: jest.Mock;
  save: jest.Mock;
  insert: jest.Mock;
}

interface MockManager {
  getRepository: (entity: unknown) => MockRepository;
}

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
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    sadd: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    srem: jest.fn().mockResolvedValue(1),
    smembers: jest.fn(),
    pipeline: jest.fn(() => ({
      del: jest.fn(),
      exec: jest.fn().mockResolvedValue([]),
    })),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_ACCESS_EXPIRES_IN') return 900;
      if (key === 'JWT_REFRESH_EXPIRES_IN') return 604800;
      return null;
    }),
  };

  const mockDataSource = {
    transaction: jest
      .fn()
      .mockImplementation((cb: (manager: MockManager) => Promise<unknown>) =>
        cb({
          getRepository: jest.fn().mockReturnValue({
            findOne: jest.fn().mockResolvedValue(null),
            save: jest.fn().mockResolvedValue({}),
            insert: jest.fn().mockResolvedValue({}),
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

  describe('refresh', () => {
    it('should successfully refresh token when it is not used', async () => {
      const mockTokenData = {
        userId: 'user_123',
        email: 'user@solavie.vn',
        isUsed: false,
      };
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(mockTokenData));
      mockJwtService.sign.mockReturnValue('new_access_token');

      const result = await service.refresh('old_token');
      expect(result).toHaveProperty('accessToken', 'new_access_token');
      expect(result).toHaveProperty('refreshToken');
      expect(mockRedisClient.set).toHaveBeenCalled();
      expect(mockRedisClient.srem).toHaveBeenCalledWith(
        'iam:user_sessions:user_123',
        'old_token',
      );
      expect(mockRedisClient.sadd).toHaveBeenCalled();
    });

    it('should detect breach and revoke sessions if token is used and grace period expired', async () => {
      const mockTokenData = {
        userId: 'user_123',
        email: 'user@solavie.vn',
        isUsed: true,
        usedAt: new Date(Date.now() - 40000).toISOString(), // 40 seconds ago
        replacedBy: 'replaced_token',
      };
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(mockTokenData));
      mockRedisClient.smembers.mockResolvedValueOnce(['replaced_token']);

      await expect(service.refresh('old_token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should return already generated token within grace period if replaced token exists', async () => {
      const mockTokenData = {
        userId: 'user_123',
        email: 'user@solavie.vn',
        isUsed: true,
        usedAt: new Date(Date.now() - 10000).toISOString(), // 10 seconds ago (within 30s)
        replacedBy: 'replaced_token',
      };
      mockRedisClient.get.mockImplementation((key) => {
        if (key === 'iam:refresh_token:old_token') {
          return Promise.resolve(JSON.stringify(mockTokenData));
        }
        if (key === 'iam:refresh_token:replaced_token') {
          return Promise.resolve(
            JSON.stringify({ userId: 'user_123', isUsed: false }),
          );
        }
        return Promise.resolve(null);
      });
      mockJwtService.sign.mockReturnValue('mocked_access_token');

      const result = await service.refresh('old_token');
      expect(result.refreshToken).toBe('replaced_token');
      expect(result.accessToken).toBe('mocked_access_token');
    });
  });

  describe('exchangeActivationToken', () => {
    it('should throw BadRequestException if token is missing or expired in Redis', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null);

      await expect(
        service.exchangeActivationToken('user@solavie.vn', 'invalid_token'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if email does not match token data', async () => {
      const tokenData = { email: 'expected@solavie.vn', userId: '123' };
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(tokenData));

      await expect(
        service.exchangeActivationToken('mismatch@solavie.vn', 'some_token'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if user is not found in database', async () => {
      const tokenData = { email: 'user@solavie.vn', userId: '123' };
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(tokenData));
      mockUserRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.exchangeActivationToken('user@solavie.vn', 'some_token'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should exchange token successfully and return setup token', async () => {
      const tokenData = { email: 'user@solavie.vn', userId: '123' };
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(tokenData));

      const mockUser = {
        id: '123',
        email: 'user@solavie.vn',
        fullName: 'John Doe',
      };
      mockUserRepository.findOne.mockResolvedValueOnce(mockUser);

      mockJwtService.sign.mockReturnValue('mock_setup_token');

      const result = await service.exchangeActivationToken(
        'user@solavie.vn',
        'some_token',
      );
      expect(result).toEqual({
        setupToken: 'mock_setup_token',
        userId: '123',
        email: 'user@solavie.vn',
        fullName: 'John Doe',
      });
      expect(mockRedisClient.del).toHaveBeenCalled();
    });
  });
});
