import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { IamTables, IamDefaults } from '../constants/iam.constants';

@Entity(IamTables.USER_SETTINGS)
export class UserSettingEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @Column({ name: 'preferred_lang', default: IamDefaults.LANG, length: 5 })
  preferredLang: string;

  @Column({ default: IamDefaults.TIMEZONE, length: 50 })
  timezone: string;

  @Column({ default: IamDefaults.THEME, length: 20 })
  theme: string;

  @OneToOne(() => UserEntity, (user) => user.setting, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
