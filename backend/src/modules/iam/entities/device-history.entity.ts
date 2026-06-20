import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { IamTables } from '../constants/iam.constants';

@Entity(IamTables.DEVICE_HISTORIES)
@Index(['userId', 'deviceHash'], { unique: true })
export class IamDeviceHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ name: 'ip_address', length: 45 })
  ipAddress: string;

  @Column({ name: 'user_agent' })
  userAgent: string;

  @Column({ name: 'device_hash', length: 64 })
  deviceHash: string;

  @Column({ name: 'is_trusted', default: true })
  isTrusted: boolean;

  @Column({ name: 'last_login_at', type: 'timestamp' })
  lastLoginAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
