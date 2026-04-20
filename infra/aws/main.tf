terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (staging, production)"
  type        = string
  default     = "staging"
}

variable "vpc_id" {
  description = "VPC ID for deployment"
  type        = string
}

variable "subnets" {
  description = "List of private subnet IDs"
  type        = list(string)
}

variable "deepgram_api_key_secret_arn" {
  description = "AWS Secrets Manager ARN for Deepgram API key"
  type        = string
}

variable "twilio_secret_arn" {
  description = "AWS Secrets Manager ARN for Twilio credentials"
  type        = string
}

variable "mcp_endpoint_secret_arn" {
  description = "AWS Secrets Manager ARN for MCP endpoint"
  type        = string
}

variable "docker_image_uri" {
  description = "ECR image URI for voice-agent-kit"
  type        = string
}

variable "desired_count" {
  description = "Desired number of tasks"
  type        = number
  default     = 1
}

variable "cpu" {
  description = "CPU units (256-4096)"
  type        = number
  default     = 512
}

variable "memory" {
  description = "Memory in MiB (512-30720)"
  type        = number
  default     = 1024
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS listener"
  type        = string
  default     = ""
}

variable "alarm_sns_topic_arn" {
  description = "SNS topic ARN for CloudWatch alarm notifications"
  type        = string
  default     = ""
}

provider "aws" {
  region = var.region
}

# ECR repository (if not using existing)
resource "aws_ecr_repository" "voice_agent_kit" {
  name                 = "voice-agent-kit-${var.environment}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# CloudWatch log group
resource "aws_cloudwatch_log_group" "voice_agent_kit" {
  name              = "/ecs/voice-agent-kit-${var.environment}"
  retention_in_days = 30
}

# ECS task execution role
resource "aws_iam_role" "ecs_task_execution" {
  name = "voice-agent-kit-ecs-task-execution-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Task role for Secrets Manager access
resource "aws_iam_role" "ecs_task" {
  name = "voice-agent-kit-ecs-task-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "secrets_access" {
  name = "secrets-access"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "secretsmanager:GetSecretValue"
      ]
      Resource = [
        var.deepgram_api_key_secret_arn,
        var.twilio_secret_arn,
        var.mcp_endpoint_secret_arn
      ]
    }]
  })
}

# Security group for ECS tasks — only accepts traffic from the ALB
resource "aws_security_group" "voice_agent_kit" {
  name        = "voice-agent-kit-${var.environment}"
  description = "Security group for voice-agent-kit ECS service"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Allow inbound from ALB on app port"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "voice-agent-kit-${var.environment}"
  }
}

# ECS cluster (use existing or create new)
resource "aws_ecs_cluster" "voice_agent_kit" {
  name = "voice-agent-kit-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# ECS task definition
resource "aws_ecs_task_definition" "voice_agent_kit" {
  family                   = "voice-agent-kit-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "voice-agent-kit"
      image = var.docker_image_uri
      portMappings = [
        {
          containerPort = 3000
          protocol      = "tcp"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.voice_agent_kit.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "ecs"
        }
      }
      environment = [
        {
          name  = "NODE_ENV"
          value = var.environment == "production" ? "production" : "development"
        },
        {
          name  = "PORT"
          value = "3000"
        }
      ]
      secrets = [
        {
          name      = "DEEPGRAM_API_KEY"
          valueFrom = var.deepgram_api_key_secret_arn
        },
        {
          name      = "TWILIO_ACCOUNT_SID"
          valueFrom = "${var.twilio_secret_arn}:TWILIO_ACCOUNT_SID::"
        },
        {
          name      = "TWILIO_AUTH_TOKEN"
          valueFrom = "${var.twilio_secret_arn}:TWILIO_AUTH_TOKEN::"
        },
        {
          name      = "MCP_ENDPOINT"
          valueFrom = var.mcp_endpoint_secret_arn
        }
      ]
      healthCheck = {
        command = ["CMD-SHELL", "wget -q --spider http://localhost:3000/health || exit 1"]
        interval = 30
        timeout  = 5
        retries  = 3
      }
    }
  ])
}

# ALB security group
resource "aws_security_group" "alb" {
  name        = "voice-agent-kit-alb-${var.environment}"
  description = "Security group for ALB"
  vpc_id      = var.vpc_id

  ingress {
    description = "Allow inbound from Twilio"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ALB (use existing or create new)
resource "aws_lb" "voice_agent_kit" {
  count              = 1
  name               = "voice-agent-kit-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.subnets
}

resource "aws_lb_target_group" "voice_agent_kit" {
  name        = "voice-agent-kit-${var.environment}"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    protocol            = "HTTP"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  stickiness {
    type            = "lb_cookie"
    cookie_duration = 86400
    enabled         = true
  }
}

resource "aws_lb_listener" "voice_agent_kit" {
  load_balancer_arn = aws_lb.voice_agent_kit[0].arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.voice_agent_kit.arn
  }
}

# ECS service
resource "aws_ecs_service" "voice_agent_kit" {
  name            = "voice-agent-kit-${var.environment}"
  cluster         = aws_ecs_cluster.voice_agent_kit.id
  task_definition = aws_ecs_task_definition.voice_agent_kit.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.subnets
    security_groups = [aws_security_group.voice_agent_kit.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.voice_agent_kit.arn
    container_name   = "voice-agent-kit"
    container_port   = 3000
  }

  depends_on = [aws_iam_role_policy_attachment.ecs_task_execution]
}

# CloudWatch alarms
resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  alarm_name          = "voice-agent-kit-high-cpu-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80

  dimensions = {
    ClusterName = aws_ecs_cluster.voice_agent_kit.name
    ServiceName = aws_ecs_service.voice_agent_kit.name
  }

  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
}

resource "aws_cloudwatch_metric_alarm" "high_memory" {
  alarm_name          = "voice-agent-kit-high-memory-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80

  dimensions = {
    ClusterName = aws_ecs_cluster.voice_agent_kit.name
    ServiceName = aws_ecs_service.voice_agent_kit.name
  }

  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
}

output "service_name" {
  value = aws_ecs_service.voice_agent_kit.name
}

output "cluster_name" {
  value = aws_ecs_cluster.voice_agent_kit.name
}

output "alb_dns_name" {
  value = aws_lb.voice_agent_kit[*].dns_name
}
