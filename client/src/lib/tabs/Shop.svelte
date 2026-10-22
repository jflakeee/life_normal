<script lang="ts">
	import { gold } from '$lib/format';
	import type { Game } from '$lib/game.svelte';

	let { game }: { game: Game } = $props();
	const items = $derived(Object.entries(game.catalog!.shop));
	const owned = $derived(new Set(game.player!.equipment));
	const rate = $derived(game.catalog!.repair_rate);
</script>

<div class="stack">
	<p class="quiet">장비는 일부 임무의 조건입니다. 가진 장비 중 가장 비싼 것의 수리비가 임무 8건마다 빠져요</p>
	{#each items as [name, price] (name)}
		<div class="panel row">
			<div>
				<h2>{name}</h2>
				<p class="quiet num">{gold(price)} · 수리비 8건마다 {(price * rate).toLocaleString('ko-KR')} G</p>
			</div>
			{#if owned.has(name)}
				<span class="quiet">보유</span>
			{:else}
				<button class="secondary" disabled={game.player!.money < price || game.busy} onclick={() => game.buy(name)}>구매</button>
			{/if}
		</div>
	{/each}
</div>
