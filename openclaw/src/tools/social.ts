/**
 * Social Media Tools — linkedin_post, instagram_post
 */

import type { Tool, ScopedToken, ToolResult } from './tool.interface.js';

export const linkedinPost: Tool = {
  name: 'linkedin_post',
  description: 'Create a post on LinkedIn with text content and optional media.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const content = params['content'];

    if (typeof content !== 'string' || content.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "content" is required and must be a non-empty string.' };
    }

    if (content.length > 3000) {
      return { success: false, data: null, error: 'LinkedIn post content must not exceed 3000 characters.' };
    }

    const mediaUrl = typeof params['mediaUrl'] === 'string' ? params['mediaUrl'] : undefined;

    // Stub: returns mock LinkedIn post result
    return {
      success: true,
      data: {
        postId: `urn:li:share:${Date.now()}`,
        content,
        mediaUrl,
        status: 'published',
      },
    };
  },
};

export const instagramPost: Tool = {
  name: 'instagram_post',
  description: 'Create a post on Instagram with an image and caption.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const imageUrl = params['imageUrl'];
    const caption = params['caption'];

    if (typeof imageUrl !== 'string' || imageUrl.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "imageUrl" is required and must be a non-empty string.' };
    }
    if (typeof caption !== 'string') {
      return { success: false, data: null, error: 'Parameter "caption" is required and must be a string.' };
    }

    if (caption.length > 2200) {
      return { success: false, data: null, error: 'Instagram caption must not exceed 2200 characters.' };
    }

    // Stub: returns mock Instagram post result
    return {
      success: true,
      data: {
        mediaId: `ig_${Date.now()}`,
        imageUrl,
        caption,
        status: 'published',
      },
    };
  },
};
