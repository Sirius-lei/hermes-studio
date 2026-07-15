import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/sub-agents'

export const subAgentRoutes = new Router()

subAgentRoutes.get('/api/DiTing/sub-agents', ctrl.list)
subAgentRoutes.put('/api/DiTing/sub-agents', ctrl.replace)
