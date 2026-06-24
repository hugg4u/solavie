# Đặc Tả Business Logic Module Agent Inbox

## 1. Xử Lý Đột Phá Đụng Độ Soạn Thảo (Collision Detection Lock)

Để đảm bảo Collision Lock không bị treo khi nhân viên gõ dở câu rồi rời máy, hệ thống tận dụng cơ chế **Redis Key Expiration** làm bộ đếm tự động mở khóa 5 giây:

```typescript
import { WebSocketGateway, WebSocketServer, SubscribeMessage } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { InjectRedis } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';

@WebSocketGateway({ namespace: 'inbox' })
export class InboxGateway {
  @WebSocketServer() server: Server;
  private readonly TYPING_TTL = 5; // Tự động giải phóng sau 5 giây (Hoàng tử đã phê duyệt)

  constructor(@InjectRedis('cache') private readonly redis: Redis) {}

  @SubscribeMessage('client:typing')
  async handleTyping(client: Socket, payload: { conversationId: string; isTyping: boolean }) {
    const agentId = client.data.user.id;
    const agentName = client.data.user.fullName;
    const roomName = `conversation:${payload.conversationId}`;
    const redisLockKey = `lock:typing:conversation:${payload.conversationId}`;

    if (payload.isTyping) {
      // 1. Ghi nhận lock gõ phím vào Redis Cache với TTL 5 giây
      const lockData = JSON.stringify({ agentId, agentName });
      await this.redis.set(redisLockKey, lockData, 'EX', this.TYPING_TTL);

      // 2. Broadcast thông báo cho các Agent khác trong cùng room
      const expiresAt = Date.now() + this.TYPING_TTL * 1000;
      client.to(roomName).emit('server:typing_status', {
        conversationId: payload.conversationId,
        agentId,
        agentName,
        isTyping: true,
        expiresAt
      });
    } else {
      // Nếu Client chủ động báo dừng gõ, hoặc gửi tin -> Xóa Lock trong Redis
      const currentLock = await this.redis.get(redisLockKey);
      if (currentLock) {
        const { agentId: lockedAgentId } = JSON.parse(currentLock);
        if (lockedAgentId === agentId) {
          await this.redis.del(redisLockKey);
        }
      }

      client.to(roomName).emit('server:typing_status', {
        conversationId: payload.conversationId,
        agentId,
        agentName,
        isTyping: false,
        expiresAt: 0
      });
    }
  }
}
```

---

## 2. Gửi Tin Nhắn Từ Nhân Viên Sales (Sales Message Delivery)

Khi nhân viên Sales gửi tin nhắn, hệ thống kiểm tra và cập nhật trạng thái đồng thời tắt AI để tránh tranh chấp:

```typescript
@Injectable()
export class AgentInboxService {
  constructor(
    @InjectRepository(ChatConversation)
    private readonly conversationRepo: Repository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private readonly messageRepo: Repository<ChatMessage>,
    private readonly gatewayApiService: GatewayApiService, // Module Gateway gửi tin
    @InjectRedis('cache') private readonly redis: Redis,
    private readonly inboxGateway: InboxGateway
  ) {}

  async sendAgentMessage(
    conversationId: string, 
    content: string, 
    agentId: string, 
    tag?: 'CONFIRMED_EVENT_UPDATE' | 'HUMAN_AGENT'
  ): Promise<ChatMessage> {
    const conversation = await this.conversationRepo.findOneBy({ id: conversationId });
    if (!conversation) {
      throw new NotFoundException('Không tìm thấy cuộc trò chuyện');
    }

    // 1. Kiểm tra chính sách cửa sổ 24 giờ của Facebook/Zalo
    const now = Date.now();
    const lastCustomerMessageTime = conversation.last_customer_message_at 
      ? new Date(conversation.last_customer_message_at).getTime()
      : 0;
    const isWithin24Hours = (now - lastCustomerMessageTime) <= 24 * 60 * 60 * 1000;

    if (!isWithin24Hours) {
      if (conversation.channel === 'FACEBOOK') {
        if (!tag) {
          throw new BadRequestException(
            'OUTSIDE_24H_WINDOW: Hết thời gian phản hồi tự do 24h. Bạn bắt buộc phải chọn gửi mẫu tin nhắn đính tag (Template).'
          );
        }
      } else if (conversation.channel === 'ZALO') {
        throw new BadRequestException(
          'OUTSIDE_24H_WINDOW: Zalo OA cấm gửi tin nhắn văn bản tự do ngoài 24h. Bạn bắt buộc phải chuyển sang gửi Zalo ZNS.'
        );
      }
    }

    // 2. Kiểm soát trạng thái cuộc trò chuyện (Tắt AI nếu đang tự động)
    if (conversation.state === 'AUTOMATIC') {
      conversation.state = 'MANUAL';
      conversation.assignee_id = agentId;
      await this.conversationRepo.save(conversation);
      
      // Notify cho hệ thống biết phân vai đã thay đổi
      this.inboxGateway.server.emit('server:conversation.assigned', {
        conversationId,
        assigneeId: agentId,
        assigneeName: 'Nhân viên hệ thống'
      });
    }

    // 3. Lưu tin nhắn vào DB loại HUMAN_AGENT
    const message = this.messageRepo.create({
      conversation_id: conversationId,
      sender_type: 'HUMAN_AGENT',
      content,
      created_at: new Date()
    });
    const savedMessage = await this.messageRepo.save(message);

    // 4. Gọi Gateway Module để đẩy tin nhắn sang Zalo OA hoặc Facebook Page thực tế kèm tag
    await this.gatewayApiService.sendMessage({
      channel: conversation.channel,
      recipientId: conversation.sender_id, // Zalo ID hoặc Facebook PSID
      text: content,
      tag: tag // Gửi tag sang Gateway
    });

    // 5. Giải phóng Typing Lock trên Redis và phát WebSocket kết thúc typing
    await this.redis.del(`lock:typing:conversation:${conversationId}`);
    this.inboxGateway.server.to(`conversation:${conversationId}`).emit('server:typing_status', {
      conversationId,
      agentId,
      agentName: '',
      isTyping: false,
      expiresAt: 0
    });

    return savedMessage;
  }
}
```

---

## 3. Tạo Ghi Chú & Thảo Luận Nội Bộ (Internal Comments Tagging)

Quản lý luồng bình luận nội bộ ẩn và tự động parse tag tên để bắn thông báo WebSockets:

```typescript
@Injectable()
export class InternalCommentService {
  constructor(
    @InjectRepository(InternalComment)
    private readonly commentRepo: Repository<InternalComment>,
    @InjectRepository(IamUser)
    private readonly userRepo: Repository<IamUser>,
    private readonly inboxGateway: InboxGateway
  ) {}

  async createComment(conversationId: string, content: string, senderId: string, senderName: string): Promise<InternalComment> {
    // 1. Lưu ghi chú nội bộ vào CSDL
    const comment = this.commentRepo.create({
      conversation_id: conversationId,
      sender_id: senderId,
      content,
      created_at: new Date()
    });
    const saved = await this.commentRepo.save(comment);

    // 2. Trích xuất tag tên bằng Regex (Ví dụ: "@Nguyễn Văn A")
    const tagMatches = content.match(/@([a-zA-Z0-9\s]+?)(?=\s|$)/g);
    
    if (tagMatches) {
      for (const match of tagMatches) {
        const targetName = match.replace('@', '').trim();
        // Tìm user tương ứng trong hệ thống
        const targetUser = await this.userRepo.findOneBy({ full_name: ILike(`%${targetName}%`) });
        
        if (targetUser) {
          // Bắn WebSocket Event trực tiếp cho User được tag
          this.inboxGateway.server.to(`user:${targetUser.id}`).emit('server:internal_comment.created', {
            conversationId,
            commentId: saved.id,
            taggedByName: senderName,
            briefContent: content.length > 50 ? content.substring(0, 50) + '...' : content
          });
        }
      }
    }

    return saved;
  }
}
```

---

## 4. Giải Thuật Phân Chia Chat Tự Động (Round-Robin Auto-Routing)

Khi hệ thống kích hoạt tự động phân vai hội thoại `MANUAL` cho Sales:

```typescript
@Injectable()
export class AutoAssignmentService {
  constructor(
    @InjectRepository(ChatConversation)
    private readonly conversationRepo: Repository<ChatConversation>,
    @InjectRepository(IamUser)
    private readonly userRepo: Repository<IamUser>,
    @InjectRedis('cache') private readonly redis: Redis,
    private readonly inboxGateway: InboxGateway
  ) {}

  /**
   * Phân chia Round-Robin cho các Sales đang Online (Hoàng tử đã phê duyệt)
   */
  async assignConversationRoundRobin(conversationId: string): Promise<void> {
    // 1. Lấy danh sách ID các Sales đang online từ Redis Set
    const onlineSalesIds = await this.redis.smembers('online_agents');
    
    if (onlineSalesIds.length === 0) {
      this.logger.warn(`Không có Sales nào online. Cuộc chat ${conversationId} sẽ nằm ở Tab Chưa giao.`);
      return;
    }

    // 2. Lấy con trỏ Round-Robin hiện tại từ Redis
    const pointerStr = await this.redis.get('pointer:round_robin_sales');
    let pointer = pointerStr ? parseInt(pointerStr, 10) : 0;

    // Sắp xếp danh sách cố định để đảm bảo tính xoay vòng chính xác
    onlineSalesIds.sort();

    // 3. Tính toán vị trí nhân viên được gán tiếp theo
    const assignedIndex = pointer % onlineSalesIds.length;
    const assignedSalesId = onlineSalesIds[assignedIndex];

    // 4. Cập nhật DB
    const conversation = await this.conversationRepo.findOneBy({ id: conversationId });
    if (conversation) {
      conversation.assignee_id = assignedSalesId;
      conversation.state = 'MANUAL';
      await this.conversationRepo.save(conversation);

      const assignedUser = await this.userRepo.findOneBy({ id: assignedSalesId });

      // 5. Broadcast WebSocket thông báo phân vai mới
      this.inboxGateway.server.emit('server:conversation.assigned', {
        conversationId,
        assigneeId: assignedSalesId,
        assigneeName: assignedUser ? assignedUser.full_name : 'Sales Rep'
      });

      // 6. Tăng con trỏ và lưu lại Redis
      await this.redis.set('pointer:round_robin_sales', (pointer + 1).toString());
    }
  }
}
```
*Ghi chú:* Danh sách `online_agents` trong Redis Set được duy trì động bằng cách thêm vào khi Sales thiết lập socket kết nối (`connection` event) và tự động xóa khỏi set khi socket bị ngắt (`disconnect` event).

---

## 5. Bảo Mật API (API Security & Data Filtering)

### 5.1. ABAC Data Filtering (Kiểm Soát Danh Sách Hội Thoại)
Khi lấy danh sách hội thoại (`GET /api/v1/inbox/conversations`), bắt buộc phải sử dụng TypeORM QueryBuilder để lọc dữ liệu theo quyền, tuyệt đối không tải lên RAM rồi filter:

```typescript
const query = this.conversationRepo.createQueryBuilder('conversation');

if (user.role === 'SALES') {
  // Sales chỉ xem các cuộc hội thoại mà mình được giao (hoặc hội thoại chưa ai nhận mà đang ở trạng thái MANUAL)
  query.andWhere(
    new Brackets(qb => {
      qb.where('conversation.assignee_id = :userId', { userId: user.id })
        .orWhere('conversation.assignee_id IS NULL AND conversation.state = :state', { state: 'MANUAL' });
    })
  );
}
// MANAGER/ADMIN xem toàn bộ

const [data, count] = await query.getManyAndCount();
```
