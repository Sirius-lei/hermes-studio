import Router from '@koa/router'
import * as ctrl from '../../controllers/hermes/sub-agents'

export const subAgentRoutes = new Router()

subAgentRoutes.get('/api/hermes/sub-agents', ctrl.list)
subAgentRoutes.put('/api/hermes/sub-agents', ctrl.replace)
