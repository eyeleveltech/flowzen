import { Router } from 'express';
import { apiKeyAuth } from '../../middleware/apiKeyAuth';
import leadRouter from './leads';
import taskRouter from './tasks';

const publicApiRouter = Router();

// Secure all v1 routes with API Key
publicApiRouter.use(apiKeyAuth);

publicApiRouter.use('/leads', leadRouter);
publicApiRouter.use('/tasks', taskRouter);

export default publicApiRouter;
