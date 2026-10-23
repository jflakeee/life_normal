<script lang="ts">
	import { gold, RANK_NAME } from '$lib/format';
	import type { Game } from '$lib/game.svelte';

	let { game }: { game: Game } = $props();
	const p = $derived(game.player!);
	const biz = $derived(game.catalog!.business);
	const items = $derived(Object.entries(game.market));
	const raw = $derived(items.filter(([, m]) => !m.from));
	const processed = $derived(items.filter(([, m]) => m.from));
	const moved = $derived(items.some(([, m]) => Math.abs(m.price - m.base) > 0.01));
	const chiefLines = $derived(Object.entries(p.jobs).filter(([, j]) => j.rank === 'CHIEF'));
	const events = $derived(game.board.events.slice(-3).reverse());
	const wk = $derived(game.catalog!.workers);
	const bd = $derived(game.catalog!.buildings);
	const lineNames = $derived(game.catalog!.lines);
	const buildingLines = $derived(Object.keys(lineNames).filter((l) => l !== 'COLLECTING'));
</script>

<div class="stack">
	{#if moved && events.length}
		<div class="event">
			<h2>시세가 움직였어요</h2>
			{#each events as e (e)}<p class="quiet">{e.replace(/^\[\s*\d+\]\s*/, '')}</p>{/each}
		</div>
	{/if}

	<section class="panel">
		<h2>오늘 시세</h2>
		<p class="quiet">채집·수렵 보상은 원자재 시세를, 가공 이윤은 두 시세의 차이를 따라갑니다</p>
		{#each [['원자재', raw], ['가공품', processed]] as const as [title, group] (title)}
		<h3>{title}</h3>
		<ul class="prices">
			{#each group as [id, m] (id)}
				{@const d = m.price / m.base - 1}
				<li class="row">
					<span>{m.name}{m.from ? ` ← ${game.market[m.from].name}` : ''}</span>
					<span class="num">
						{m.price.toFixed(1)} G
						<small class:up={d > 0.005} class:down={d < -0.005}>
							{d > 0.005 ? `▲${Math.round(d * 100)}%` : d < -0.005 ? `▼${Math.round(-d * 100)}%` : `기준 ${m.base}`}
						</small>
					</span>
				</li>
			{/each}
		</ul>
		{/each}
	</section>

	<section class="panel stack">
		<h2>사업</h2>
		{#if p.businesses.length}
			<p class="num">
				{p.businesses.length}개 운영 중 · 받을 정산 {p.pending_settlements}회
			</p>
			<p class="quiet">
				2.4시간마다 1회, 하루 최대 {biz.settlements_per_day}회 쌓입니다. 정산 1회에 사업 1개당 매출 약 {biz.revenue} G에서
				매출세 {Math.round(biz.tax * 100)}%와 유지비가 빠져요. 4개째부터는 총이익이 줄어듭니다
			</p>
			<button class="secondary" disabled={!p.pending_settlements || game.busy} onclick={() => game.collect()}>정산 받기</button>
			<ul class="biz">
				{#each p.businesses as line, i (i)}
					<li class="row">
						<span>{lineNames[line]} 사업 {i + 1} · 일꾼 {p.workers[i] ?? 0}/{wk.max}</span>
						<button
							class="secondary"
							disabled={(p.workers[i] ?? 0) >= wk.max || p.money < wk.hire_cost || game.busy}
							onclick={() => game.hire(i)}
						>
							고용 {gold(wk.hire_cost)}
						</button>
					</li>
				{/each}
			</ul>
			<p class="quiet">일꾼 1명당 그 사업의 정산 매출 +{Math.round(wk.revenue_bonus * 100)}%, 정산마다 급여 {wk.wage} G</p>
		{:else}
			<p class="quiet">직업이 책임 직급이 되고 {gold(biz.open_cost)}를 모으면 사업을 열 수 있어요</p>
		{/if}
		{#each chiefLines as [line] (line)}
			<button class="secondary" disabled={p.money < biz.open_cost || game.busy} onclick={() => game.openBusiness(line)}>
				{game.catalog!.lines[line]} 사업 열기 · {gold(biz.open_cost)}
			</button>
		{/each}
		{#if chiefLines.length === 0 && Object.keys(p.jobs).length}
			<p class="quiet">
				지금 직급: {Object.entries(p.jobs)
					.map(([l, j]) => `${game.catalog!.lines[l]} ${RANK_NAME[j.rank]}`)
					.join(', ')}
			</p>
		{/if}
	</section>

	<section class="panel stack">
		<h2>건물 확장</h2>
		<p class="quiet">확장할 때마다 그 계열 임무 보상이 +{Math.round(bd.reward_bonus * 100)}% 올라요 (최대 {bd.costs.length}단계)</p>
		<ul class="biz">
			{#each buildingLines as line (line)}
				{@const cost = p.upgrade_costs[line]}
				<li class="row">
					<span>{lineNames[line]} · {p.buildings[line] ?? 0}단계</span>
					{#if cost === null}
						<span class="quiet">최고 단계</span>
					{:else}
						<button class="secondary" disabled={p.money < cost || game.busy} onclick={() => game.upgrade(line)}>
							확장 {gold(cost)}
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
</div>

<style>
	.biz {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	h3 {
		margin: 14px 0 0;
		font-size: 13px;
		font-weight: 700;
		color: var(--ink-2);
	}
	.prices {
		list-style: none;
		margin: 4px 0 0;
		padding: 0;
	}
	.prices li {
		min-height: 40px;
		border-top: 1px solid var(--line);
	}
	small {
		color: var(--ink-2);
		margin-left: 6px;
	}
	small.up {
		color: var(--seal);
	}
	small.down {
		color: var(--action);
	}
</style>
