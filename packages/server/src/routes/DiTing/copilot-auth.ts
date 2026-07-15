import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/copilot-auth'

export const copilotAuthRoutes = new Router()

copilotAuthRoutes.post('/api/DiTing/auth/copilot/start', ctrl.start)
copilotAuthRoutes.get('/api/DiTing/auth/copilot/poll/:sessionId', ctrl.poll)
copilotAuthRoutes.get('/api/DiTing/auth/copilot/check-token', ctrl.checkToken)
copilotAuthRoutes.post('/api/DiTing/auth/copilot/enable', ctrl.enable)
copilotAuthRoutes.post('/api/DiTing/auth/copilot/disable', ctrl.disable)
