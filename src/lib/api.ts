/** 클라이언트가 쓰는 백엔드 인터페이스. 지금은 브라우저 안 백엔드(local/backend.ts) 하나,
 *  멀티플레이 단계에서 서버 백엔드를 같은 모양으로 추가한다. */

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

export type ServerEvent = { type: string; [k: string]: unknown };

export interface Backend {
	readonly hasToken: boolean;
	login(): Promise<void>;
	get<T>(path: string): Promise<T>;
	command<T>(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<T>;
	/** 알림 구독. onStatus(false)는 연결 끊김. 해제 함수를 돌려준다 */
	subscribe(onEvent: (e: ServerEvent) => void, onStatus: (online: boolean) => void): () => void;
}
