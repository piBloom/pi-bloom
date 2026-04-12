export type InboundMessage = {
  provider: "signal";
  chatId: string;
  senderId: string;
  senderName?: string;
  messageId: string;
  timestamp: string;
  text: string;
  isGroup: boolean;
};

export type ChatSession = {
  chatId: string;
  senderId: string;
  sessionPath: string;
  createdAt: string;
  updatedAt: string;
};

export type PiReply = {
  text: string;
  sessionPath: string;
};
