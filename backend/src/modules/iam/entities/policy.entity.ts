import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { RoleEntity } from './role.entity';
import { PermissionEntity } from './permission.entity';
import { IamTables } from '../constants/iam.constants';

@Entity(IamTables.POLICIES)
@Index(['roleId', 'permissionId'], { unique: true })
export class PolicyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'role_id' })
  roleId: string;

  @Column({ name: 'permission_id' })
  permissionId: string;

  @ManyToOne(() => RoleEntity, (role) => role.policies, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role: RoleEntity;

  @ManyToOne(() => PermissionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'permission_id' })
  permission: PermissionEntity;

  @Column({ name: 'rule_expression', nullable: true })
  ruleExpression: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
