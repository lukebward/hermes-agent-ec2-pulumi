import * as pulumi from "@pulumi/pulumi";
import { createNetwork } from "./network";
import { createInstance } from "./instance";
import { renderUserData } from "./userdata";

const config = new pulumi.Config();
const publicKey = config.require("publicKey");
const sshCidr = config.require("sshCidr");
const openaiApiKey = config.requireSecret("openaiApiKey");
const openaiModel = config.get("openaiModel") ?? "gpt-5";
const instanceType = config.get("instanceType") ?? "t4g.medium";

const telegramBotToken = config.getSecret("telegramBotToken");
const telegramAllowedUsers = config.get("telegramAllowedUsers");
if (Boolean(telegramBotToken) !== Boolean(telegramAllowedUsers)) {
    throw new Error("telegramBotToken and telegramAllowedUsers must both be set, or both unset");
}

const name = "hermes";

const network = createNetwork(name, { sshCidr });

const userData: pulumi.Output<string> = telegramBotToken && telegramAllowedUsers
    ? pulumi.all([openaiApiKey, telegramBotToken]).apply(([oai, tg]) =>
        renderUserData({
            openaiApiKey: oai,
            openaiModel,
            telegram: { botToken: tg, allowedUsers: telegramAllowedUsers },
        }))
    : openaiApiKey.apply(key => renderUserData({ openaiApiKey: key, openaiModel }));

const { instance, eip } = createInstance(name, {
    publicKey,
    instanceType,
    userData,
    securityGroupId: network.securityGroup.id,
});

export const instanceId = instance.id;
export const publicIp = eip.publicIp;
export const sshCommand = pulumi.interpolate`ssh ubuntu@${eip.publicIp}`;
export const tunnelHint = pulumi.interpolate`# Hermes dashboard auto-starts at boot. To reach it:
#   ssh -L 9119:localhost:9119 ubuntu@${eip.publicIp}
# then open http://localhost:9119 in your browser.`;
export const telegramConfigured = Boolean(telegramBotToken);
