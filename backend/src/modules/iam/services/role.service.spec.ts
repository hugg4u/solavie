import { Test, TestingModule } from '@nestjs/testing';
import { RoleService } from './role.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { RoleEntity } from '../entities/role.entity';
import { UserRoleEntity } from '../entities/user-role.entity';
import { UserEntity } from '../entities/user.entity';
import { PermissionService } from './permission.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

interface MockRepository {
  save?: jest.Mock;
  findOne?: jest.Mock;
  delete?: jest.Mock;
}

interface MockManager {
  getRepository: (entity: unknown) => MockRepository;
}

describe('RoleService', () => {
  let service: RoleService;

  const mockRoleRepository = {
    findOne: jest.fn(),
  };

  const mockUserRoleRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  const mockUserRepository = {
    findOne: jest.fn(),
  };

  const mockPermissionService = {
    invalidateUserPermissionCache: jest.fn().mockResolvedValue(undefined),
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
            if (entity === UserRoleEntity) return mockUserRoleRepository;
            return {
              save: jest.fn().mockResolvedValue({ id: 'outbox_123' }),
            };
          }),
        }),
      ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleService,
        {
          provide: getRepositoryToken(RoleEntity),
          useValue: mockRoleRepository,
        },
        {
          provide: getRepositoryToken(UserRoleEntity),
          useValue: mockUserRoleRepository,
        },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: mockUserRepository,
        },
        {
          provide: PermissionService,
          useValue: mockPermissionService,
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

    service = module.get<RoleService>(RoleService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('assignRole', () => {
    it('should throw NotFoundException if user does not exist', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.assignRole('user_123', 'ADMIN', 'admin_123', '127.0.0.1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if role does not exist', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce({ id: 'user_123' });
      mockRoleRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.assignRole('user_123', 'INVALID', 'admin_123', '127.0.0.1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should successfully assign role', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce({ id: 'user_123' });
      mockRoleRepository.findOne.mockResolvedValueOnce({
        id: 'role_123',
        code: 'ADMIN',
      });
      mockUserRoleRepository.findOne.mockResolvedValueOnce(null);

      await service.assignRole('user_123', 'ADMIN', 'admin_123', '127.0.0.1');

      expect(
        mockPermissionService.invalidateUserPermissionCache,
      ).toHaveBeenCalledWith('user_123');
      expect(mockOutboxQueue.add).toHaveBeenCalled();
    });
  });

  describe('removeRole', () => {
    it('should throw NotFoundException if user does not exist', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.removeRole('user_123', 'ADMIN', 'admin_123', '127.0.0.1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if admin attempts to remove role from themselves', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce({ id: 'admin_123' });

      await expect(
        service.removeRole('admin_123', 'ADMIN', 'admin_123', '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if role does not exist', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce({ id: 'user_123' });
      mockRoleRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.removeRole('user_123', 'ADMIN', 'admin_123', '127.0.0.1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should successfully remove role', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce({ id: 'user_123' });
      mockRoleRepository.findOne.mockResolvedValueOnce({
        id: 'role_123',
        code: 'ADMIN',
      });
      mockUserRoleRepository.findOne.mockResolvedValueOnce({
        userId: 'user_123',
        roleId: 'role_123',
      });

      await service.removeRole('user_123', 'ADMIN', 'admin_123', '127.0.0.1');

      expect(
        mockPermissionService.invalidateUserPermissionCache,
      ).toHaveBeenCalledWith('user_123');
      expect(mockOutboxQueue.add).toHaveBeenCalled();
    });
  });
});
