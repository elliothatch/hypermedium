// import { Router, Request, Response } from 'express';
// import { validate, validateData } from 'fresh-validation';

// namespace Webhook {
//     export type Event = Event.Post;
//     export namespace Event {

//         export class Post {
//             @validate()
//             event!: 'POST';

//             @validate()
//             url!: string;

//             @validate()
//             author!: string;
//         }


//     }
//     // export namespace Api {
//     //     export namespace register {
//     //         export class Request {
//     //             @validate()
//     //             events: Event.Type[];
//     //         }
//     //     }
//     // }
// }

// export class WebhookPlugin {
//     public router: Router;

//     constructor() {
//         const router = Router();
//         router.use('/register', this.register);
//         this.router = router;
//     }

//     protected register = (req: Request, res: Response) => {
//         // req.body
//     };
// }

