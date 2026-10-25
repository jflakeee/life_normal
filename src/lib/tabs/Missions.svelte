<script lang="ts">
	import { clock, TYPE_NAME } from '$lib/format';
	import type { Game } from '$lib/game.svelte';

	let { game }: { game: Game } = $props();
	let filter = $state<'ACTION' | 'ROUTINE' | 'REQUEST' | 'EMERGENCY'>('ROUTINE');
	const actions = $derived(game.catalog!.actions);

	const lines = $derived(game.catalog!.lines);
	const postings = $derived(game.board.postings.filter((x) => !x.chain && x.type === filter));
	const routines = $derived(game.routineTemplates);
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
		{#each ['ACTION', 'ROUTINE', 'REQUEST', 'EMERGENCY'] as const as t (t)}
			<button role="tab" aria-selected={filter === t} class:on={filter === t} onclick={() => (filter = t)}>{t === 'ACTION' ? '행동' : TYPE_NAME[t]}</button>
		{/each}
	</div>

	{#if filter === 'ACTION'}
		<p class="quiet">일상 행동은 여러 계열 취미 경험을 조금씩 쌓고, 직업을 갖거나 전직할 때 조건이 돼요. 한 건에 2 G</p>
		<ul class="list">
			{#each actions as a (a.id)}
				{@const st = game.player!.actions[a.id]}
				<li class="panel row">
					<div>
						<h2>{a.name} <span class="quiet num">Lv {st.level}</span></h2>
						<p class="quiet">{a.example} · {a.spread.map(([l]) => lines[l]).join('·')} 취미로{st.bonus ? ` · 습관 +${st.bonus}%` : ''}</p>
					</div>
					<div class="put">
						{#each game.slots as s (s.index)}
							<button
								class="secondary"
								class:on={s.template === a.task}
								disabled={game.busy || s.template === a.task}
								aria-label="작업대 {s.index + 1}에 {a.name} 올리기"
								onclick={() => game.setWork(s.index, a.task)}
							>
								{game.slots.length === 1 ? (s.template === a.task ? '진행 중' : '올리기') : s.index + 1}
							</button>
						{/each}
					</div>
				</li>
			{/each}
		</ul>
	{:else if filter === 'ROUTINE'}
		<p class="quiet">
			작업대:
			{game.slots.map((s) => `${s.index + 1} ${s.name ?? '비어 있음'}`).join(', ')}
		</p>
		<ul class="list">
			{#each routines as t (t.id)}
				<li class="panel row">
					<div>
						<h2>{t.name}</h2>
						<p class="quiet">
							{lines[t.line]}{t.tier === 'JOB' ? ' 직업' : ''}{t.process ? ` · ${t.process.input} → ${t.process.output}` : ''}
						</p>
					</div>
					<div class="put">
						{#each game.slots as s (s.index)}
							<button
								class="secondary"
								class:on={s.template === t.id}
								disabled={game.busy || s.template === t.id}
								aria-label="작업대 {s.index + 1}에 올리기"
								onclick={() => game.setWork(s.index, t.id)}
							>
								{game.slots.length === 1 ? (s.template === t.id ? '진행 중' : '올리기') : s.index + 1}
							</button>
						{/each}
					</div>
				</li>
			{/each}
		</ul>
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
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	.put {
		display: flex;
		gap: 6px;
		flex: none;
	}
	.put button {
		min-width: 44px;
	}
	.put button.on {
		background: var(--action);
		color: var(--action-ink);
		opacity: 1;
	}
	.empty {
		padding: 24px 4px;
	}
</style>
