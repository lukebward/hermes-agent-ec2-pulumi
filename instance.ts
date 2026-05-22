import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export interface InstanceArgs {
    publicKey: string;
    instanceType: string;
    userData: pulumi.Input<string>;
    securityGroupId: pulumi.Input<string>;
}

export interface HermesInstance {
    instance: aws.ec2.Instance;
    eip: aws.ec2.Eip;
}

const UBUNTU_2404_ARM64_SSM = "/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id";

export function createInstance(name: string, args: InstanceArgs): HermesInstance {
    const amiParam = aws.ssm.getParameterOutput({ name: UBUNTU_2404_ARM64_SSM });

    const keyPair = new aws.ec2.KeyPair(`${name}-key`, {
        publicKey: args.publicKey,
    });

    const instance = new aws.ec2.Instance(`${name}-host`, {
        ami: amiParam.value,
        instanceType: args.instanceType,
        keyName: keyPair.keyName,
        vpcSecurityGroupIds: [args.securityGroupId],
        userData: args.userData,
        userDataReplaceOnChange: true,
        rootBlockDevice: {
            volumeType: "gp3",
            volumeSize: 30,
            deleteOnTermination: true,
        },
        tags: { Name: name },
    });

    const eip = new aws.ec2.Eip(`${name}-eip`, { domain: "vpc" });

    new aws.ec2.EipAssociation(`${name}-eip-assoc`, {
        instanceId: instance.id,
        allocationId: eip.id,
    });

    return { instance, eip };
}
