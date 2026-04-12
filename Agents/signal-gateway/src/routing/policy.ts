export class Policy {
  constructor(
    private readonly allowedNumbers: Set<string>,
    private readonly directMessagesOnly: boolean,
    private readonly botAccount: string,
  ) {}

  isAllowedSender(senderId: string): boolean {
    if (senderId === this.botAccount) return false;
    return this.allowedNumbers.has(senderId);
  }

  isAllowedMessage(isGroup: boolean): boolean {
    if (this.directMessagesOnly && isGroup) return false;
    return true;
  }
}
