<script lang="ts">
	import { duration, gold } from '$lib/format';
	import type { Game } from '$lib/game.svelte';

	let { game }: { game: Game } = $props();
	const a = $derived(game.away!);
	let primary = $state<HTMLButtonElement>();
	$effect(() => {
		primary?.focus();
	});
</script>

<div class="backdrop">
	<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="away-title">
		<h2 id="away-title">자리를 비운 동안 · {duration(a.seconds)}</h2>
		{#if !a.result}
			<ul>
				{#if a.pending}<li><span class="seal"></span> 끝낸 작업 <strong class="num">{a.pending}건</strong></li>{/if}
				{#each a.events.slice(-4) as e (e)}<li class="quiet">{e}</li>{/each}
			</ul>
			{#if a.pending}
				<button class="primary" bind:this={primary} disabled={game.busy} onclick={() => game.claimAway()}>한 번에 받기</button>
			{/if}
			<button class="later" onclick={() => (game.away = null)}>{a.pending ? '나중에' : '확인'}</button>
		{:else}
			<ul>
				<li>받은 돈 <strong class="num">{a.result.gained >= 0 ? '+' : ''}{gold(a.result.gained)}</strong></li>
				{#each a.result.levels as l (l)}<li>▲ {l}</li>{/each}
				{#each a.result.drops as d (d)}<li>도감 등록: {d}</li>{/each}
			</ul>
			<button class="primary" bind:this={primary} onclick={() => (game.away = null)}>확인</button>
		{/if}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
		display: flex;
		align-items: flex-end;
		background: color-mix(in srgb, var(--ink) 35%, transparent);
	}
	.sheet {
		width: 100%;
		max-width: 560px;
		margin: 0 auto;
		display: grid;
		gap: 12px;
		padding: 20px 16px calc(16px + env(safe-area-inset-bottom, 0px));
		background: var(--surface);
		border-radius: 18px 18px 0 0;
		animation: up 220ms ease-out;
	}
	@keyframes up {
		from {
			transform: translateY(24px);
			opacity: 0;
		}
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.seal {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--seal);
	}
	.later {
		color: var(--ink-2);
	}
</style>
