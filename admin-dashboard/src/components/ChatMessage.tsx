import React from 'react';

/**
 * Represents a single chat message in the CalangoBot conversation.
 */
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ChatMessageProps {
  message: Message;
}

/**
 * ChatMessage — Individual message bubble component.
 * Renders user messages aligned right and assistant messages aligned left.
 */
export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: '8px',
      }}
    >
      <div
        style={{
          maxWidth: '70%',
          padding: '10px 14px',
          borderRadius: '12px',
          backgroundColor: isUser ? '#4f46e5' : '#f3f4f6',
          color: isUser ? '#ffffff' : '#1f2937',
          fontSize: '14px',
          lineHeight: '1.5',
          wordBreak: 'break-word',
        }}
      >
        <p style={{ margin: 0 }}>{message.content}</p>
        <span
          style={{
            display: 'block',
            fontSize: '10px',
            marginTop: '4px',
            opacity: 0.7,
            textAlign: isUser ? 'right' : 'left',
          }}
        >
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
};
