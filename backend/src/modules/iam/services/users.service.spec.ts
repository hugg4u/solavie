import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { UserEntity } from '../entities/user.entity';
import { AuthService } from './auth.service';
import { PermissionService } from './permission.service';
import { ConfigService } from '@nestjs/config';
import { REDIS_CACHE_CLIENT } from '../../../core/redis/redis.module';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

interface MockRepository {
  create: jest.Mock;
  save: jest.Mock;
  findOne: jest.Mock;
  find: jest.Mock;
  delete: jest.Mock;
}

interface MockManager {
  getRepository: (entity: unknown) => MockRepository;
}

describe('UsersService', () => {
  let service: UsersService;

  const mockUserRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    })),
  };

  const mockAuthService = {
    revokeAllSessions: jest.fn().mockResolvedValue(undefined),
  };

  const mockPermissionService = {
    invalidateUserPermissionCache: jest.fn().mockResolvedValue(undefined),
  };

  const mockRedisClient = {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'ACTIVATION_TOKEN_TTL_SEC') return 172800;
      return null;
    }),
  };

  const mockOutboxQueue = {
    add: jest.fn().mockResolvedValue({}),
  };

  const mockDataSource = {
    transaction: jest
      .fn()
      .mockImplementation((cb: (manager: MockManager) => Promise<unknown>) =>
        cb({
          getRepository: jest.fn().mockImplementation((entity: unknown) => {
            if (entity === UserEntity) return mockUserRepository;
            return {
              create: jest.fn().mockImplementation((x: unknown) => x),
              save: jest.fn().mockImplementation((x: unknown) =>
                Promise.resolve({
                  id: 'saved_id',
                  ...(x as Record<string, unknown>),
                }),
              ),
              findOne: jest.fn().mockResolvedValue({ id: 'settings_id' }),
              find: jest.fn().mockResolvedValue([]),
              delete: jest.fn().mockResolvedValue({}),
            };
          }),
        }),
      ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: mockUserRepository,
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: PermissionService,
          useValue: mockPermissionService,
        },
        {
          provide: REDIS_CACHE_CLIENT,
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
          useValue: mockOutboxQueue,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findById', () => {
    it('should throw NotFoundException if user is not found', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce(null);

      await expect(service.findById('invalid_id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return user details successfully', async () => {
      const mockUser = {
        id: 'user_123',
        email: 'user@solavie.vn',
        fullName: 'Alice',
      };
      mockUserRepository.findOne.mockResolvedValueOnce(mockUser);

      const result = await service.findById('user_123');
      expect(result).toEqual(mockUser);
    });
  });

  describe('findAll', () => {
    it('should apply role filtering using separate innerJoin instead of andWhere directly', async () => {
      const mockQueryBuilder = mockUserRepository.createQueryBuilder();
      mockUserRepository.createQueryBuilder.mockReturnValueOnce(
        mockQueryBuilder,
      );

      await service.findAll({
        page: 1,
        limit: 10,
        skip: 0,
        take: 10,
        roleId: 'role_123',
      });

      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'user.userRoles',
        'filterUserRole',
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'filterUserRole.roleId = :roleId',
        { roleId: 'role_123' },
      );
    });
  });

  describe('createUser', () => {
    it('should throw ConflictException if email exists', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'user_123',
        email: 'user@solavie.vn',
      });

      await expect(
        service.createUser(
          { fullName: 'Bob', email: 'user@solavie.vn' },
          'admin_123',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should create user and serialize token metadata to Redis as JSON', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce(null);
      mockUserRepository.create.mockImplementationOnce((x: unknown) => x);
      mockUserRepository.save.mockResolvedValueOnce({
        id: 'user_bob',
        email: 'bob@solavie.vn',
        fullName: 'Bob',
      });

      const result = await service.createUser(
        { fullName: 'Bob', email: 'bob@solavie.vn' },
        'admin_123',
      );

      expect(result.id).toBe('user_bob');
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        expect.stringContaining('iam:activation:hash:'),
        expect.stringContaining('"email":"bob@solavie.vn"'),
        'EX',
        172800,
      );
    });
  });

  describe('updateUser', () => {
    it('should prevent self-deactivation', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'admin_123',
        email: 'admin@solavie.vn',
        isActive: true,
      });

      await expect(
        service.updateUser(
          'admin_123',
          { isActive: false },
          'admin_123',
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should prevent self-role modification', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'admin_123',
        email: 'admin@solavie.vn',
        isActive: true,
      });

      await expect(
        service.updateUser(
          'admin_123',
          { roleCode: 'SALES' },
          'admin_123',
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
