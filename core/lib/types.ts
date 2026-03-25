/**
 * Shared domain types with no external dependencies.
 */

export interface MatrixTextEvent {
	roomId: string;
	eventId: string;
	senderUserId: string;
	body: string;
	timestamp: number;
}

export interface MatrixIdentity {
	id: string;
	userId: string;
	homeserver: string;
	accessToken: string;
	autojoin?: boolean;
}
