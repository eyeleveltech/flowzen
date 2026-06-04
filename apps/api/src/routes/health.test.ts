import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { app } from '../index.js';

describe('Health Check API', () => {
  it('should return 200 OK and status JSON', async () => {
    const response = await request(app).get('/api/health');
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
    expect(response.body).toHaveProperty('timestamp');
  });
});
