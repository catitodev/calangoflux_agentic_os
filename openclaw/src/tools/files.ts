/**
 * File Tools — file_read, file_write, pdf_generate, image_resize
 */

import type { Tool, ScopedToken, ToolResult } from './tool.interface.js';

export const fileRead: Tool = {
  name: 'file_read',
  description: 'Read the contents of a file from a storage location.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const path = params['path'];

    if (typeof path !== 'string' || path.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "path" is required and must be a non-empty string.' };
    }

    const encoding = typeof params['encoding'] === 'string' ? params['encoding'] : 'utf-8';

    // Stub: returns mock file content
    return {
      success: true,
      data: {
        path,
        encoding,
        content: `Mock file content for: ${path}`,
        size: 1024,
      },
    };
  },
};

export const fileWrite: Tool = {
  name: 'file_write',
  description: 'Write content to a file at a specified storage location.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const path = params['path'];
    const content = params['content'];

    if (typeof path !== 'string' || path.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "path" is required and must be a non-empty string.' };
    }
    if (typeof content !== 'string') {
      return { success: false, data: null, error: 'Parameter "content" is required and must be a string.' };
    }

    // Stub: returns mock file write result
    return {
      success: true,
      data: {
        path,
        bytesWritten: Buffer.byteLength(content, 'utf-8'),
        status: 'written',
      },
    };
  },
};

export const pdfGenerate: Tool = {
  name: 'pdf_generate',
  description: 'Generate a PDF document from HTML content or a template.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const html = params['html'];
    const outputPath = params['outputPath'];

    if (typeof html !== 'string' || html.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "html" is required and must be a non-empty string.' };
    }
    if (typeof outputPath !== 'string' || outputPath.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "outputPath" is required and must be a non-empty string.' };
    }

    // Stub: returns mock PDF generation result
    return {
      success: true,
      data: {
        outputPath,
        pages: 1,
        sizeBytes: 45000,
        status: 'generated',
      },
    };
  },
};

export const imageResize: Tool = {
  name: 'image_resize',
  description: 'Resize an image to specified dimensions.',

  async execute(params: Record<string, unknown>, _credential: ScopedToken): Promise<ToolResult> {
    const inputPath = params['inputPath'];
    const width = params['width'];
    const height = params['height'];

    if (typeof inputPath !== 'string' || inputPath.trim().length === 0) {
      return { success: false, data: null, error: 'Parameter "inputPath" is required and must be a non-empty string.' };
    }
    if (typeof width !== 'number' || width <= 0) {
      return { success: false, data: null, error: 'Parameter "width" is required and must be a positive number.' };
    }
    if (typeof height !== 'number' || height <= 0) {
      return { success: false, data: null, error: 'Parameter "height" is required and must be a positive number.' };
    }

    const outputPath = typeof params['outputPath'] === 'string' ? params['outputPath'] : inputPath;

    // Stub: returns mock image resize result
    return {
      success: true,
      data: {
        inputPath,
        outputPath,
        width,
        height,
        format: 'png',
        status: 'resized',
      },
    };
  },
};
