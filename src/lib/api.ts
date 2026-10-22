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
	/** 기기에 저장하는 백엔드만 제공: 세이브 이동과 초기화 */
	saves?: SaveTransfer;
}

export interface SaveTransfer {
	export(): string;
	/** 검사 실패 시 ApiError(422)를 던지고 진행은 그대로 둔다 */
	import(raw: string): void;
	reset(): void;
}
