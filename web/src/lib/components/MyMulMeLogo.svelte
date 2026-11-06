<script lang="ts">
  import type { ClassValue } from 'svelte/elements';

  interface Props {
    variant?: 'icon' | 'inline';
    size?: 'tiny' | 'small' | 'medium' | 'large' | 'giant';
    class?: ClassValue;
  }

  let { variant = 'icon', size = 'medium', class: className = '' }: Props = $props();

  const sizeClass = {
    tiny: 'h-6 w-6',
    small: 'h-8 w-8',
    medium: 'h-10 w-10',
    large: 'h-12 w-12',
    giant: 'h-16 w-16',
  }[size];
</script>

{#if variant === 'inline'}
  <span class={['inline-flex h-10 items-center gap-1.5', className]} role="img" aria-label="MyMulMe">
    <img src="/mymulme-icon.png" class="h-full w-auto object-contain" alt="" />
    <img src="/mymulme-wordmark.png" class="h-6 w-auto object-contain" alt="" />
  </span>
{:else}
  <img src="/mymulme-icon.png" class={['block object-contain', sizeClass, className]} alt="MyMulMe" />
{/if}
