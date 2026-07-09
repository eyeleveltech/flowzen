import { Router } from 'express';
import { apiKeyAuth } from '../../middleware/apiKeyAuth';
import leadRouter from './leads';
import taskRouter from './tasks';
import projectRouter from './projects';
import { docsHtml } from './docsHtml';

const publicApiRouter = Router();

// Public documentation (unauthenticated)
publicApiRouter.get('/docs', (req, res) => {
  res.send(docsHtml);
});

// Secure all other v1 routes with API Key
publicApiRouter.use(apiKeyAuth);

publicApiRouter.use('/leads', leadRouter);
publicApiRouter.use('/tasks', taskRouter);
publicApiRouter.use('/projects', projectRouter);

export default publicApiRouter;
