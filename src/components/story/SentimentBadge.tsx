type Props = { sentiment: string }

const sentimentConfig = {
  positive: { label: 'Positive', className: 'bg-green-500/10 text-green-500 border-green-500/20' },
  negative: { label: 'Negative', className: 'bg-red-500/10 text-red-500 border-red-500/20' },
  mixed: { label: 'Mixed', className: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
  neutral: { label: 'Neutral', className: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
}

export function SentimentBadge({ sentiment }: Props) {
  const config = sentimentConfig[sentiment as keyof typeof sentimentConfig] ?? sentimentConfig.neutral
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border font-medium ${config.className}`}>
      {config.label}
    </span>
  )
}
