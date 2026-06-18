# Logging & Monitoring — Module Agent Inbox

## 1. Cấu Trúc Log Chuẩn (Structured JSON Logging)

### 1.1. Log khi Sales kết nối WebSocket
```json
{
  "timestamp": "2026-06-16T03:00:00.000Z",
  "level": "info",
  "module": "Inbox",
  "context": "InboxGateway",
  "message": "Agent connected to WebSocket",
  "metadata": {
    "agentId": "uuid",
    "socketId": "socket_id",
    "online_agents_count": 5
  }
}
```

### 1.2. Log khi Conversation được gán cho Sales (Claim / Round-Robin)
```json
{
  "timestamp": "2026-06-16T03:00:10.000Z",
  "level": "info",
  "module": "Inbox",
  "context": "AutoAssignmentService",
  "message": "Conversation assigned to agent",
  "traceId": "req_trace_uuid",
  "metadata": {
    "conversationId": "uuid",
    "assigneeId": "uuid",
    "assignmentMethod": "ROUND_ROBIN",
    "online_agents_at_time": 4
  }
}
```

### 1.3. Log khi @mention được phát hiện và event được emit
```json
{
  "timestamp": "2026-06-16T03:01:00.000Z",
  "level": "info",
  "module": "Inbox",
  "context": "InternalCommentService",
  "message": "Agent mention detected, notification event emitted",
  "traceId": "req_trace_uuid",
  "metadata": {
    "conversationId": "uuid",
    "mentionedAgentId": "uuid",
    "mentionerAgentId": "uuid",
    "event_emitted": "inbox.agent_mentioned"
  }
}
```

### 1.4. Log khi Sales gửi tin nhắn cho khách
```json
{
  "timestamp": "2026-06-16T03:01:30.000Z",
  "level": "info",
  "module": "Inbox",
  "context": "InboxService",
  "message": "Agent message sent to customer",
  "traceId": "req_trace_uuid",
  "metadata": {
    "conversationId": "uuid",
    "agentId": "uuid",
    "channel": "FACEBOOK",
    "message_length": 120,
    "duration_ms": 245
  }
}
```

### 1.5. Log khi Typing Lock bị tranh chấp
```json
{
  "timestamp": "2026-06-16T03:02:00.000Z",
  "level": "warn",
  "module": "Inbox",
  "context": "InboxGateway",
  "message": "Typing lock collision detected",
  "metadata": {
    "conversationId": "uuid",
    "requesterAgentId": "uuid",
    "currentHolderAgentId": "uuid"
  }
}
```

---

## 2. Labels cho Promtail/Loki

- `module`: "Inbox"
- `context`: InboxGateway | AutoAssignmentService | InternalCommentService | InboxService
- `level`: info | warn | error

---

## 3. Cảnh Báo Grafana (Alert Rules)

| Tên Rule | Điều kiện | Hành động |
|---------|-----------|-----------|
| **NO_AGENTS_ONLINE** | `online_agents_count = 0` trong > 10 phút giờ hành chính | Alert Manager/DevOps |
| **ROUND_ROBIN_SKIP** | Conversation unassigned > 5 phút | Alert Manager |
| **WS_CONNECTION_DROP** | Số disconnect > 10 trong 1 phút | Alert DevOps |

---

## 4. Metrics Cần Expose (Prometheus)

```
inbox_online_agents_total
inbox_conversations_assigned_total{method="ROUND_ROBIN"}
inbox_conversations_assigned_total{method="MANUAL_CLAIM"}
inbox_agent_message_duration_ms{channel="FACEBOOK", quantile="0.95"}
inbox_typing_lock_collision_total
inbox_unassigned_conversations_total
```
