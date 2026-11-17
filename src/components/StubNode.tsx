import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { EyeOff } from 'lucide-react';

export interface StubNodeData extends Record<string, unknown> {
  direction: 'in' | 'out';
  count: number;
  summary: string;
  isDimmed?: boolean;
}

function StubNodeComponent({ data }: NodeProps<Node<StubNodeData>>) {
  const label =
    data.direction === 'in'
      ? `+${data.count} hidden req`
      : `+${data.count} hidden unlock${data.count > 1 ? 's' : ''}`;

  return (
    <div
      className={`stub-node ${data.isDimmed ? 'stub-node--dimmed' : ''}`}
      title={`Filtered out: ${data.summary}`}
    >
      {data.direction === 'out' && (
        <Handle type="target" position={Position.Left} className="stub-handle" />
      )}
      <EyeOff size={12} />
      <span>{label}</span>
      {data.direction === 'in' && (
        <Handle type="source" position={Position.Right} className="stub-handle" />
      )}
    </div>
  );
}

export const StubNode = memo(StubNodeComponent);
