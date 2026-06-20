import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from './permissions.guard';
import { Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserRoleEntity } from '../entities/user-role.entity';
import { REDIS_CACHE_CLIENT } from '../../../core/redis/redis.module';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

  const mockUserRoleRepository = {
    find: jest.fn(),
  };

  const mockRedisClient = {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'PERMISSION_CACHE_TTL') return '3600';
      return null;
    }),
  };

  const createMockExecutionContext = (user: unknown): ExecutionContext => {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          params: { id: 'resource_123' },
          query: {},
          body: {},
        }),
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(UserRoleEntity),
          useValue: mockUserRoleRepository,
        },
        {
          provide: REDIS_CACHE_CLIENT,
          useValue: mockRedisClient,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    guard = module.get<PermissionsGuard>(PermissionsGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow access if handler is public', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === 'isPublic') return true;
      return undefined;
    });

    const context = createMockExecutionContext(null);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('should allow access if no permissions are required', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === 'isPublic') return false;
      if (key === 'permissions') return [];
      return undefined;
    });

    const context = createMockExecutionContext({ id: 'user_123' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('should return false if user is missing in context', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === 'isPublic') return false;
      if (key === 'permissions') return ['iam.users.read'];
      return undefined;
    });

    const context = createMockExecutionContext(null);
    await expect(guard.canActivate(context)).resolves.toBe(false);
  });

  it('should evaluate permissions from Redis cache if available', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === 'isPublic') return false;
      if (key === 'permissions') return ['iam.users.read'];
      return undefined;
    });

    const mockPermissionsCache = {
      'iam.users.read': true,
    };
    mockRedisClient.get.mockResolvedValueOnce(
      JSON.stringify(mockPermissionsCache),
    );

    const context = createMockExecutionContext({ id: 'user_123' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockRedisClient.get).toHaveBeenCalledWith(
      'iam:user_permissions:user_123',
    );
  });

  it('should fallback to database on cache miss, evaluate ruleExpression, and save cache', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === 'isPublic') return false;
      if (key === 'permissions') return ['iam.users.read'];
      return undefined;
    });

    mockRedisClient.get.mockResolvedValueOnce(null);

    const mockUserRoles = [
      {
        role: {
          policies: [
            {
              ruleExpression: JSON.stringify({
                '===': [{ var: 'params.id' }, 'resource_123'],
              }),
              permission: {
                action: 'iam.users.read',
              },
            },
          ],
        },
      },
    ];
    mockUserRoleRepository.find.mockResolvedValueOnce(mockUserRoles);

    const context = createMockExecutionContext({ id: 'user_123' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockRedisClient.set).toHaveBeenCalled();
  });
});
