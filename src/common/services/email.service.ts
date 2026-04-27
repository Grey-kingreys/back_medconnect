import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private resend: Resend;
  private fromEmail: string;

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
    this.fromEmail =
      process.env.RESEND_FROM_EMAIL || 'MedConnect <onboarding@resend.dev>';
  }

  // ─── Emails Auth ──────────────────────────────────────────────

  async sendWelcomeEmail(
    email: string,
    nom: string,
    prenom: string,
  ): Promise<void> {
    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: '🎉 Bienvenue sur MedConnect !',
        html: this.buildLayout(
          'Bienvenue sur MedConnect !',
          `
          <p>Bonjour <strong>${prenom} ${nom}</strong>,</p>
          <p>Votre compte a été créé avec succès. Vous pouvez maintenant accéder à toutes les fonctionnalités de MedConnect :</p>
          <ul>
            <li>Gérer votre carnet de santé numérique</li>
            <li>Localiser des services médicaux près de vous</li>
            <li>Consulter la disponibilité des médicaments</li>
            <li>Accéder à l'assistance IA en cas de besoin</li>
          </ul>
          <div style="text-align:center;margin:30px 0">
            <a href="${process.env.FRONTEND_URL}/login" style="${this.btnStyle('#2563eb')}">Se connecter</a>
          </div>
          <p>Cordialement,<br>L'équipe MedConnect</p>
        `,
        ),
      });
    } catch (error) {
      console.error(`❌ Erreur email bienvenue à ${email}:`, error);
    }
  }

  async sendPasswordResetEmail(
    email: string,
    nom: string,
    prenom: string,
    resetToken: string,
  ): Promise<void> {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: '🔐 Réinitialisation de votre mot de passe — MedConnect',
        html: this.buildLayout(
          'Réinitialisation de mot de passe',
          `
          <p>Bonjour <strong>${prenom} ${nom}</strong>,</p>
          <p>Nous avons reçu une demande de réinitialisation de mot de passe pour votre compte.</p>
          <div style="text-align:center;margin:30px 0">
            <a href="${resetUrl}" style="${this.btnStyle('#dc2626')}">Réinitialiser mon mot de passe</a>
          </div>
          <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:15px;margin:20px 0;border-radius:4px">
            <strong>⚠️ Important :</strong> Ce lien est valide pendant <strong>1 heure</strong>.
            Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.
          </div>
          <p>Lien direct : <a href="${resetUrl}" style="color:#2563eb;word-break:break-all">${resetUrl}</a></p>
          <p>Cordialement,<br>L'équipe MedConnect</p>
        `,
        ),
      });
    } catch (error) {
      console.error(`❌ Erreur email reset à ${email}:`, error);
      throw new Error("Impossible d'envoyer l'email de réinitialisation");
    }
  }

  // ─── Email Invitation Structure ───────────────────────────────

  async sendStructureInviteEmail(
    email: string,
    structureNom: string,
    structureType: string,
    inviteToken: string,
  ): Promise<void> {
    const setupUrl = `${process.env.FRONTEND_URL}/setup-structure?token=${inviteToken}`;
    const typeLabel = this.getTypeLabel(structureType);

    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: `🏥 Invitation — Configurez votre ${typeLabel} sur MedConnect`,
        html: this.buildLayout(
          `Bienvenue sur MedConnect`,
          `
          <p>Bonjour,</p>
          <p>Votre ${typeLabel} <strong>${structureNom}</strong> a été enregistrée sur la plateforme <strong>MedConnect</strong>.</p>
          <p>Pour finaliser la configuration de votre espace, cliquez sur le bouton ci-dessous :</p>
          <div style="text-align:center;margin:30px 0">
            <a href="${setupUrl}" style="${this.btnStyle('#059669')}">Configurer mon espace</a>
          </div>
          <p>Vous pourrez :</p>
          <ul>
            <li>Créer votre mot de passe administrateur</li>
            <li>Compléter les informations de votre ${typeLabel}</li>
            <li>Ajouter vos médecins et membres du personnel</li>
          </ul>
          <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:15px;margin:20px 0;border-radius:4px">
            <strong>⚠️ Ce lien expire dans 72 heures.</strong>
          </div>
          <p>Lien direct : <a href="${setupUrl}" style="color:#2563eb;word-break:break-all">${setupUrl}</a></p>
          <p>Cordialement,<br>L'équipe MedConnect</p>
        `,
        ),
      });
      console.log(`✅ Email invitation envoyé à ${email}`);
    } catch (error) {
      console.error(`❌ Erreur email invitation à ${email}:`, error);
      throw new Error("Impossible d'envoyer l'email d'invitation");
    }
  }

  async sendMemberWelcomeEmail(
    email: string,
    nom: string,
    prenom: string,
    role: string,
    structureNom: string,
    temporaryPassword: string,
  ): Promise<void> {
    const roleLabel = this.getRoleLabel(role);
    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: `🏥 Votre compte ${roleLabel} sur MedConnect — ${structureNom}`,
        html: this.buildLayout(
          `Votre compte MedConnect`,
          `
          <p>Bonjour <strong>${prenom} ${nom}</strong>,</p>
          <p>Un compte <strong>${roleLabel}</strong> vous a été créé sur MedConnect pour la structure <strong>${structureNom}</strong>.</p>
          <div style="background:#f0fdf4;border:1px solid #86efac;padding:20px;border-radius:8px;margin:20px 0">
            <p style="margin:0"><strong>Email :</strong> ${email}</p>
            <p style="margin:8px 0 0"><strong>Mot de passe temporaire :</strong> <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px">${temporaryPassword}</code></p>
          </div>
          <p>Connectez-vous et changez votre mot de passe dès que possible.</p>
          <div style="text-align:center;margin:30px 0">
            <a href="${process.env.FRONTEND_URL}/login" style="${this.btnStyle('#2563eb')}">Se connecter</a>
          </div>
          <p>Cordialement,<br>L'équipe MedConnect</p>
        `,
        ),
      });
    } catch (error) {
      console.error(`❌ Erreur email membre à ${email}:`, error);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private buildLayout(title: string, content: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;margin:0;padding:0;background:#f9fafb">
          <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
            <div style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:30px;text-align:center">
              <h1 style="color:#fff;margin:0;font-size:24px">🏥 MedConnect</h1>
              <p style="color:#bfdbfe;margin:8px 0 0;font-size:14px">${title}</p>
            </div>
            <div style="padding:30px">${content}</div>
            <div style="background:#f1f5f9;padding:20px;text-align:center;font-size:12px;color:#64748b">
              <p style="margin:0">© ${new Date().getFullYear()} MedConnect — Plateforme de Santé Numérique</p>
              <p style="margin:4px 0 0">Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  private btnStyle(color: string): string {
    return `display:inline-block;padding:12px 32px;background:${color};color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px`;
  }

  private getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      HOPITAL: 'hôpital',
      CLINIQUE: 'clinique',
      PHARMACIE: 'pharmacie',
    };
    return labels[type] || type.toLowerCase();
  }

  private getRoleLabel(role: string): string {
    const labels: Record<string, string> = {
      MEDECIN: 'médecin',
      PHARMACIEN: 'pharmacien',
      STRUCTURE_ADMIN: 'administrateur',
    };
    return labels[role] || role.toLowerCase();
  }
}