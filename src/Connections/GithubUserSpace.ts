import { IConnection } from "./IConnection";
import { Appservice, Space } from "matrix-bot-sdk";
import LogWrapper from "../LogWrapper";
import { Octokit } from "@octokit/rest";
import axios from "axios";
import { GitHubDiscussionSpace } from ".";

const log = new LogWrapper("GitHubOwnerSpace");

export interface GitHubUserSpaceConnectionState {
    username: string;
    nodeId: string;
}

/**
 * Handles rooms connected to a github repo.
 */
export class GitHubUserSpace implements IConnection {
    static readonly CanonicalEventType = "uk.half-shot.matrix-github.user.space";

    static readonly EventTypes = [
        GitHubUserSpace.CanonicalEventType, // Legacy event, with an awful name.
    ];

    static readonly QueryRoomRegex = /#github_(.+):.*/;

    static async onQueryRoom(result: RegExpExecArray, opts: {octokit: Octokit, as: Appservice}): Promise<Record<string, unknown>> {
        if (!result) {
            log.error("Invalid alias pattern");
            throw Error("Could not find issue");
        }

        const [ username ] = result?.slice(1);

        log.info(`Fetching ${username}`);
        let state: GitHubUserSpaceConnectionState;
        let avatarUrl: string|undefined;
        let name: string;
        try {
            // TODO: Determine if the repo has discussions?
            const userRes = (await opts.octokit.users.getByUsername({
                username,
            })).data;
            if (!userRes) {
                throw Error('User does not exist!');
            }
            name = userRes.name as string;
            state = {
                nodeId: userRes.node_id as string,
                username: userRes.login as string,
            }
            avatarUrl = userRes.avatar_url as string;
        } catch (ex) {
            log.error("Failed to get repo:", ex);
            throw Error("Could not find repo");
        }

        let avatarState: any|undefined;
        try {
            if (avatarUrl) {
                const res = await axios.get(avatarUrl, {
                    responseType: 'arraybuffer',
                });
                log.info(`uploading ${avatarUrl}`);
                // This does exist, but headers is silly and doesn't have content-type.
                const contentType: string = res.headers["content-type"];
                const mxcUrl = await opts.as.botClient.uploadContent(
                    Buffer.from(res.data as ArrayBuffer),
                    contentType,
                    `avatar_${state.username}.png`,
                );
                avatarState = {
                    type: "m.room.avatar",
                    state_key: "",
                    content: {
                        url: mxcUrl,
                    },
                };
            }
        } catch (ex) {
            log.warn("Failed to get avatar for org:", ex);
        }

        return {
            visibility: "public",
            name: `GitHub - ${name} (${state.username.toLowerCase()})`,
            topic: `GitHub page of ${state.username.toLowerCase()}`,
            preset: 'public_chat',
            room_alias_name: `github_${state.username.toLowerCase()}`,
            initial_state: [
                
                {
                    type: this.CanonicalEventType,
                    content: state,
                    state_key: state.username.toLowerCase(),
                },
                avatarState,
                {
                    type: "m.room.history_visibility",
                    state_key: "",
                    content: {
                        history_visibility: 'world_readable',
                    },
                },
            ],
            creation_content: {
                type: "m.space",
            },
            power_level_content_override: {
                ban: 100,
                events_default: 50,
                invite: 50,
                kick: 100,
                notifications: {
                    room: 100,
                },
                redact: 100,
                state_default: 100,
                users_default: 0,
            },
        };
    }

    get roomId() {
        return this.space.roomId;
    }

    constructor(public readonly space: Space,
        private state: GitHubUserSpaceConnectionState,
        private readonly stateKey: string) {}

    public isInterestedInStateEvent(eventType: string, stateKey: string) {
        return GitHubUserSpace.EventTypes.includes(eventType) && this.stateKey === stateKey;
    }

    public get owner() {
        return this.state.username.toLowerCase();
    }

    public toString() {
        return `GitHubUserSpace ${this.owner}`;
    }

    public async onRepoConnectionCreated(discussion: GitHubDiscussionSpace) {
        log.info(`Adding connection to ${this.toString()}`);
        await this.space.addChildRoom(discussion.roomId);
    }

    public async ensureDiscussionInSpace(discussion: GitHubDiscussionSpace) {
        // TODO: Optimise
        const children = await this.space.getChildEntities();
        if (!children[discussion.roomId]) {
            await this.space.addChildRoom(discussion.roomId);
        }
    }
}