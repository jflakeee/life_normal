<script lang="ts">
	import { clock, TYPE_NAME } from '$lib/format';
	import type { Game } from '$lib/game.svelte';

	let { game }: { game: Game } = $props();
	let filter = $state<'ROUTINE' | 'REQUEST' | 'EMERGENCY'>('ROUTINE');
	let picked = $state<string | null>(null);

	const lines = $derived(game.catalog!.lines);
	const free = $derived(game.catalog!.queue_limit - game.queueRuns.length);
	const postings = $derived(game.board.postings.filter((x) => !x.chain && x.type === filter));
	const routines = $derived(game.routineTemplates);
	const fillTarget = $derived(picked ?? routines[0]?.id ?? null);
</script>

<div class="stack">
	{#each game.chainPostings as e (e.id)}
		<div class="event row">
			<div>
				<h2>{e.chain}: {e.name}</h2>
				<p class="quiet">{lines[e.line]} · 보상 {e.reward} G · 기한 {e.deadline_ticks * 3}분</p>
			</div>
			{#if e.accepted}
				<span class="quiet">진행 중</span>
			{:else}
				<button class="secondary" disabled={!e.available || game.busy} onclick={() => game.accept(e.id)}>
					{e.available ? '수락' : '조건 부족'}
				</button>
			{/if}
		</div>
	{/each}

	<div class="chips" role="tablist" aria-label="임무 종류">
		{#each ['ROUTINE', 'REQUEST', 'EMERGENCY'] as const as t (t)}
			<button role="tab" aria-selected={filter === t} class:on={filter === t} onclick={() => (filter = t)}>{TYPE_NAME[t]}</button>
		{/each}
	</div>

	{#if filter === 'ROUTINE'}
		<p class="quiet num">대기열 {game.queueRuns.length}/{game.catalog!.queue_limit} · 한 건에 3분</p>
		<ul class="list">
			{#each routines as t (t.id)}
				<li class="panel row" class:picked={fillTarget === t.id}>
					<button class="pick" onclick={() => (picked = t.id)} aria-pressed={fillTarget === t.id}>
						<h2>{t.name}</h2>
						<p class="quiet">
							{lines[t.line]}{t.tier === 'JOB' ? ' 직업' : ''}{t.process ? ` · ${t.process.input} → ${t.process.output}` : ''}
						</p>
					</button>
					<button class="secondary" disabled={free <= 0 || game.busy} onclick={() => game.queue(t.id)}>+ 예약</button>
				</li>
			{/each}
		</ul>
		{#if fillTarget}
			<button class="primary fill" disabled={free <= 0 || game.busy} onclick={() => game.fillQueue(fillTarget)}>
				{free > 0 ? `남은 ${free}칸 채우기` : '대기열이 가득 찼어요'}
			</button>
		{/if}
	{:else}
		{#if game.boardRun}
			<p class="quiet num">수락한 임무: {game.boardRun.name} · {clock(game.boardRun.ends_at - game.now)}</p>
		{/if}
		<ul class="list">
			{#each postings as x (x.id)}
				<li class="panel row">
					<div>
						<h2>{x.name}</h2>
						<p class="quiet">{lines[x.line]} · {x.reward} G · 기한 {x.deadline_ticks * 3}분</p>
					</div>
					{#if x.accepted}
						<span class="quiet">진행 중</span>
					{:else}
						<button class="secondary" disabled={!x.available || !!game.boardRun || game.busy} onclick={() => game.accept(x.id)}>
							{x.available ? '수락' : '조건 부족'}
						</button>
					{/if}
				</li>
			{:else}
				<li class="quiet empty">지금은 {TYPE_NAME[filter]} 임무가 없어요. 게시판은 3분마다 바뀝니다</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.chips {
		display: flex;
		gap: 8px;
	}
	.chips button {
		min-height: 36px;
		padding: 0 16px;
		border-radius: 18px;
		border: 1px solid var(--line);
		color: var(--ink-2);
	}
	.chips button.on {
		border-color: var(--action);
		color: var(--action);
		font-weight: 700;
	}
	.list:has(+ .fill) {
		padding-bottom: 60px; /* 떠 있는 채우기 버튼이 마지막 항목을 가리지 않게 */
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	.pick {
		flex: 1;
		text-align: left;
		min-height: 0;
	}
	.picked {
		border-color: var(--action);
	}
	.fill {
		position: sticky;
		bottom: calc(var(--tabbar) + env(safe-area-inset-bottom, 0px) + 12px);
	}
	.empty {
		padding: 24px 4px;
	}
</style>
