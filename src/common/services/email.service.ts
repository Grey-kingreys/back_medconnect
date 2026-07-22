import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private resend: Resend;
  private fromEmail: string;

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
    this.fromEmail =
      process.env.RESEND_FROM_EMAIL || 'MedConnecte <onboarding@resend.dev>';
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
        subject: '🎉 Bienvenue sur MedConnecte !',
        html: this.buildLayout(
          'Bienvenue sur MedConnecte !',
          `
          <p>Bonjour <strong>${prenom} ${nom}</strong>,</p>
          <p>Votre compte a été créé avec succès. Vous pouvez maintenant accéder à toutes les fonctionnalités de MedConnecte :</p>
          <ul>
            <li>Gérer votre carnet de santé numérique</li>
            <li>Localiser des services médicaux près de vous</li>
            <li>Consulter la disponibilité des médicaments</li>
            <li>Accéder à l'assistance IA en cas de besoin</li>
          </ul>
          <div style="text-align:center;margin:30px 0">
            <a href="${process.env.FRONTEND_URL}/auth/login" style="${this.btnStyle('#2563eb')}">Se connecter</a>
          </div>
          <p>Cordialement,<br>L'équipe MedConnecte</p>
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
    const resetUrl = `${process.env.FRONTEND_URL}/auth/reset-password?token=${resetToken}`;
    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: '🔐 Réinitialisation de votre mot de passe — MedConnecte',
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
          <p>Cordialement,<br>L'équipe MedConnecte</p>
        `,
        ),
      });
    } catch (error) {
      console.error(`❌ Erreur email reset à ${email}:`, error);
      throw new Error("Impossible d'envoyer l'email de réinitialisation");
    }
  }

  // ─── Email Alerte Sécurité (tentatives de connexion) ──────────

  async sendSuspiciousLoginEmail(
    email: string,
    nom: string,
    prenom: string,
    ip: string,
  ): Promise<void> {
    const resetUrl = `${process.env.FRONTEND_URL}/auth/forgot-password`;
    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: '🔒 Tentatives de connexion suspectes — MedConnecte',
        html: this.buildLayout(
          'Alerte de sécurité',
          `
          <p>Bonjour <strong>${prenom} ${nom}</strong>,</p>
          <p>Nous avons détecté un nombre inhabituel de tentatives de connexion échouées
          sur votre compte. Par précaution, les connexions depuis cette source ont été
          temporairement bloquées.</p>
          <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:15px;margin:20px 0;border-radius:4px">
            <strong>⚠️ Si ce n'était pas vous :</strong> votre mot de passe est peut-être
            la cible d'une attaque. Nous vous recommandons de le réinitialiser dès que possible.
          </div>
          <p style="font-size:13px;color:#64748b">Origine approximative : <code>${ip}</code></p>
          <div style="text-align:center;margin:30px 0">
            <a href="${resetUrl}" style="${this.btnStyle('#dc2626')}">Réinitialiser mon mot de passe</a>
          </div>
          <p>Si vous êtes à l'origine de ces tentatives (mot de passe oublié), vous pouvez
          ignorer cet email ; l'accès sera rétabli automatiquement après quelques minutes.</p>
          <p>Cordialement,<br>L'équipe MedConnecte</p>
        `,
        ),
      });
    } catch (error) {
      console.error(`❌ Erreur email alerte connexion à ${email}:`, error);
      // Non bloquant : l'échec d'envoi ne doit pas perturber le flux d'authentification.
    }
  }

  // ─── Email Invitation Structure ───────────────────────────────

  async sendStructureInviteEmail(
    email: string,
    structureNom: string,
    structureType: string,
    inviteToken: string,
  ): Promise<void> {
    const setupUrl = `${process.env.FRONTEND_URL}/auth/setup-structure/${inviteToken}`;
    const typeLabel = this.getTypeLabel(structureType);

    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: `🏥 Invitation — Configurez votre ${typeLabel} sur MedConnecte`,
        html: this.buildLayout(
          `Bienvenue sur MedConnecte`,
          `
          <p>Bonjour,</p>
          <p>Votre ${typeLabel} <strong>${structureNom}</strong> a été enregistrée sur la plateforme <strong>MedConnecte</strong>.</p>
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
          <p>Cordialement,<br>L'équipe MedConnecte</p>
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
        subject: `🏥 Votre compte ${roleLabel} sur MedConnecte — ${structureNom}`,
        html: this.buildLayout(
          `Votre compte MedConnecte`,
          `
          <p>Bonjour <strong>${prenom} ${nom}</strong>,</p>
          <p>Un compte <strong>${roleLabel}</strong> vous a été créé sur MedConnecte pour la structure <strong>${structureNom}</strong>.</p>
          <div style="background:#f0fdf4;border:1px solid #86efac;padding:20px;border-radius:8px;margin:20px 0">
            <p style="margin:0"><strong>Email :</strong> ${email}</p>
            <p style="margin:8px 0 0"><strong>Mot de passe temporaire :</strong> <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px">${temporaryPassword}</code></p>
          </div>
          <p>Connectez-vous et changez votre mot de passe dès que possible.</p>
          <div style="text-align:center;margin:30px 0">
            <a href="${process.env.FRONTEND_URL}/auth/login" style="${this.btnStyle('#2563eb')}">Se connecter</a>
          </div>
          <p>Cordialement,<br>L'équipe MedConnecte</p>
        `,
        ),
      });
    } catch (error) {
      console.error(`❌ Erreur email membre à ${email}:`, error);
    }
  }

  // ─── Emails Urgence (SOS) ──────────────────────────────────────

  async sendEmergencyAlertEmail(
    contactEmail: string,
    contactNom: string,
    patientNom: string,
    patientPrenom: string,
    location?: { lat: number; lng: number },
    message?: string,
  ): Promise<void> {
    const mapsUrl = location 
      ? `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}` 
      : null;

    try {
      await this.resend.emails.send({
        from: 'SOS MedConnecte <sos@resend.dev>', // Ou this.fromEmail
        to: contactEmail,
        subject: `🚨 ALERTE URGENCE : ${patientPrenom} ${patientNom} a besoin d'aide !`,
        html: this.buildLayout(
          `ALERTE URGENCE CRITIQUE`,
          `
          <div style="background:#fee2e2;border:2px solid #ef4444;padding:20px;border-radius:12px;margin-bottom:20px">
            <h2 style="color:#b91c1c;margin-top:0">⚠️ ALERTE SOS DÉCLENCHÉE</h2>
            <p style="font-size:16px;color:#7f1d1d">Bonjour <strong>${contactNom}</strong>,</p>
            <p style="font-size:18px;font-weight:bold;color:#b91c1c">
              ${patientPrenom} ${patientNom} vient de déclencher une alerte d'urgence vitale via MedConnecte.
            </p>
          </div>

          <div style="margin:20px 0;padding:15px;background:#f8fafb;border-radius:8px">
            <p style="margin:0 0 10px"><strong>Message d'urgence :</strong><br>${message || "Aucun message spécifié."}</p>
            ${mapsUrl ? `
              <p style="margin:20px 0;text-align:center">
                <a href="${mapsUrl}" style="${this.btnStyle('#dc2626')}">📍 Voir la position sur Maps</a>
              </p>
              <p style="font-size:12px;color:#64748b;text-align:center">
                Coordonnées : ${location!.lat.toFixed(6)}, ${location!.lng.toFixed(6)}
              </p>
            ` : '<p><em>Position non disponible</em></p>'}
          </div>

          <div style="background:#f1f5f9;padding:15px;border-radius:8px;margin-top:20px">
            <p style="margin:0;font-size:14px;color:#475569">
              <strong>Conseils :</strong><br>
              1. Essayez de contacter ${patientPrenom} immédiatement.<br>
              2. Appelez les services d'urgence (SAMU: 15) si vous ne parvenez pas à le joindre.<br>
              3. Dirigez-vous vers sa position si possible.
            </p>
          </div>
        `,
        ),
      });
      console.log(`🚀 Email SOS envoyé avec succès à ${contactEmail}`);
    } catch (error) {
      console.error(`❌ Erreur envoi email SOS à ${contactEmail}:`, error);
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
              <h1 style="color:#fff;margin:0;font-size:24px">🏥 MedConnecte</h1>
              <p style="color:#bfdbfe;margin:8px 0 0;font-size:14px">${title}</p>
            </div>
            <div style="padding:30px">${content}</div>
            <div style="background:#f1f5f9;padding:20px;text-align:center;font-size:12px;color:#64748b">
              <p style="margin:0">© ${new Date().getFullYear()} MedConnecte — Plateforme de Santé Numérique</p>
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